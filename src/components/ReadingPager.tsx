import { useRef, useState, type ReactNode } from 'react'
import {
  Link,
  useCanGoBack,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { BOOK_BY_NO } from '@/data/canon'
import { useBible, findChapter } from '@/data/loadBible'
import { chapterUnit } from '@/lib/chinese'
import { parseHighlight } from '@/lib/highlight'
import { prevRef, nextRef, refKey, type ReadingRef } from '@/lib/readingRef'
import { skipNextVisit } from '@/lib/readingHistory'
import { useCarousel } from '@/lib/useCarousel'
import { useIsTouch } from '@/lib/useIsTouch'
import { ChapterView } from '@/components/ChapterView'
import { VerseRail } from '@/components/VerseRail'
import { OutlineView } from '@/components/OutlineView'
import { cn } from '@/lib/utils'

// ?oh= is the outline entry's index in the book outline.
function parseOhIndex(oh: string | undefined): number | undefined {
  return oh != null && /^\d+$/.test(oh) ? Number(oh) : undefined
}

function titleOf(ref: ReadingRef): ReactNode {
  const name = BOOK_BY_NO.get(ref.bookNo)?.name ?? ''
  return ref.kind === 'outline' ? (
    <>
      {name} <span className="text-muted-foreground">綱目</span>
    </>
  ) : (
    <>
      {name}{' '}
      <span className="text-muted-foreground">
        第 {ref.chapterNo} {chapterUnit(ref.bookNo)}
      </span>
    </>
  )
}

/** One reading surface (chapter or outline) for a ref. Only the active panel
 * reacts to taps / highlights / the oh-scroll. */
export function ReadingPanel({
  refData,
  active,
  hl,
  oh,
  oe,
  onSelectingChange,
  onScrubApi,
}: {
  refData: ReadingRef
  active: boolean
  hl?: string
  oh?: string
  oe?: string
  onSelectingChange?: (selecting: boolean) => void
  onScrubApi?: (scrub: ((verse: number | null) => void) | null) => void
}) {
  if (refData.kind === 'chapter') {
    return (
      <ChapterView
        bookNo={refData.bookNo}
        chapterNo={refData.chapterNo}
        active={active}
        highlights={active ? parseHighlight(hl) : []}
        ohIndex={active ? parseOhIndex(oh) : undefined}
        onSelectingChange={active ? onSelectingChange : undefined}
        onScrubApi={active ? onScrubApi : undefined}
      />
    )
  }
  return <OutlineView bookNo={refData.bookNo} active={active} oe={active ? oe : undefined} />
}

// Touch back button — a full-height bar at the header's edge.
const NAV_CLS =
  'inline-flex items-center px-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

// Desktop prev/next chapter arrows: a centered icon button.
const ARROW_CLS =
  'inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

function RefLink({ refData, children }: { refData: ReadingRef | null; children: ReactNode }) {
  if (!refData) {
    return <span className={cn(ARROW_CLS, 'pointer-events-none text-muted-foreground/40')}>{children}</span>
  }
  if (refData.kind === 'outline') {
    return (
      <Link to="/$bookNo" params={{ bookNo: refData.bookNo }} className={ARROW_CLS}>
        {children}
      </Link>
    )
  }
  return (
    <Link
      to="/$bookNo/$chapterNo"
      params={{ bookNo: refData.bookNo, chapterNo: refData.chapterNo }}
      search={{}}
      className={ARROW_CLS}
    >
      {children}
    </Link>
  )
}

/**
 * The reading surface, mounted once by the /$bookNo layout so it never remounts
 * across chapter / outline / book navigation. Reads the current ref from the
 * URL, renders the header, and (for now) the single current panel. The 3-up
 * carousel motion lands here next.
 */
export function ReadingPager() {
  const params = useParams({ strict: false }) as { bookNo: number; chapterNo?: number }
  const search = useSearch({ strict: false }) as { hl?: string; oh?: string; oe?: string }
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const isTouch = useIsTouch()

  const current: ReadingRef =
    params.chapterNo != null
      ? { kind: 'chapter', bookNo: params.bookNo, chapterNo: params.chapterNo }
      : { kind: 'outline', bookNo: params.bookNo }
  const prev = prevRef(current)
  const next = nextRef(current)

  // Only the carousel calls this — the desktop prev/next arrows are Links — so
  // it is exactly the set of moves the reading history ignores.
  const goTo = (ref: ReadingRef) => {
    skipNextVisit()
    // replace, not push: a swipe between chapters shouldn't stack a history
    // entry per chapter. It also sidesteps iOS Safari's interactive back-swipe,
    // whose page snapshot for an SPA history entry captures the *next* chapter
    // (the DOM has already swapped), so swiping back flashed 46 before 45. With
    // no per-chapter history there's no such gesture — the carousel is how you
    // go back a chapter. No view transition either: the track already animates
    // this move.
    if (ref.kind === 'outline') {
      navigate({ to: '/$bookNo', params: { bookNo: ref.bookNo }, replace: true, viewTransition: false })
    } else {
      navigate({
        to: '/$bookNo/$chapterNo',
        params: { bookNo: ref.bookNo, chapterNo: ref.chapterNo },
        search: {},
        replace: true,
        viewTransition: false,
      })
    }
  }

  const [selecting, setSelecting] = useState(false)
  // The rail lives here rather than in the panel so it can follow `titleRef` —
  // the same ref the title uses — and flip to the chapter a swipe is heading
  // for before the finger lifts. Only the landed panel can actually scroll, so
  // it hands its jump function up.
  const [scrub, setScrub] = useState<((verse: number | null) => void) | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { dx, animating, targetDir, trackProps } = useCarousel({
    containerRef: bodyRef,
    hasPrev: prev != null,
    hasNext: next != null,
    onPrev: () => prev && goTo(prev),
    onNext: () => next && goTo(next),
    resetKey: refKey(current),
    enabled: !selecting,
  })

  // Flip the title to wherever the swipe is heading — as soon as the drag passes
  // the threshold (before the finger lifts), and through the commit slide.
  const titleRef =
    (targetDir === 'prev' ? prev : targetDir === 'next' ? next : null) ?? current

  const { data: bible } = useBible()
  const railVerses =
    titleRef.kind === 'chapter'
      ? (findChapter(bible, titleRef.bookNo, titleRef.chapterNo)?.verses ?? [])
          .map((v) => v.verse)
          .filter((v) => v > 0)
      : []

  // 3-slot track: prev / current / next, current centred at translateX(-100%).
  // Keyed by ref so the landed panel keeps its (fresh, top) scroll across a
  // commit; empty slots hold the geometry at the canon's ends.
  const slots: { ref: ReadingRef | null; active: boolean }[] = [
    { ref: prev, active: false },
    { ref: current, active: true },
    { ref: next, active: false },
  ]

  return (
    <>
      <header className="border-b border-border bg-background">
        {/* Touch (incl. an installed PWA with no browser chrome): a back button,
         * no chapter arrows (swipe pages). Desktop / mouse: prev + next chapter
         * arrows — the browser already has back. Gated on touch, not width, so a
         * tablet behaves like a phone. */}
        <div className="mx-auto grid h-[var(--header-h)] max-w-3xl grid-cols-[1fr_auto_1fr] items-stretch">
          <div className="flex items-stretch">
            {isTouch ? (
              canGoBack && (
                <button
                  type="button"
                  onClick={() => router.history.back()}
                  aria-label="返回"
                  className={NAV_CLS}
                >
                  <ArrowLeft className="size-5 [stroke-width:1.8]" />
                </button>
              )
            ) : (
              <span className="flex items-center pl-1">
                <RefLink refData={prev}>
                  <ChevronLeft className="size-5 [stroke-width:1.8]" />
                </RefLink>
              </span>
            )}
          </div>
          <h1 className="self-center text-base font-medium tracking-tight">
            {titleOf(titleRef)}
          </h1>
          <div className="flex items-center justify-end pr-1">
            {!isTouch && (
              <RefLink refData={next}>
                <ChevronRight className="size-5 [stroke-width:1.8]" />
              </RefLink>
            )}
          </div>
        </div>
      </header>

      {isTouch && railVerses.length > 1 && (
        <VerseRail verses={railVerses} onScrub={(v) => scrub?.(v)} />
      )}
      {isTouch ? (
        <div
          ref={bodyRef}
          {...trackProps}
          className="relative min-h-0 flex-1 touch-pan-y overflow-hidden"
        >
          <div
            className="flex h-full"
            style={{
              transform: `translateX(calc(-100% + ${dx}px))`,
              transition: animating ? 'transform 250ms ease-out' : undefined,
            }}
          >
            {slots.map(({ ref, active }, i) => (
              // Slot wrapper is positional (fixed geometry); the panel inside is
              // keyed by ref so a ref change always mounts a FRESH scroll
              // container — it can never inherit a neighbour's scrollTop.
              <div
                key={`slot-${i}`}
                className={cn('h-full w-full shrink-0', !active && 'pointer-events-none')}
              >
                {ref && (
                  <ReadingPanel
                    key={refKey(ref)}
                    refData={ref}
                    active={active}
                    hl={active ? search.hl : undefined}
                    oh={active ? search.oh : undefined}
                    oe={active ? search.oe : undefined}
                    onSelectingChange={active ? setSelecting : undefined}
                    onScrubApi={active ? (fn) => setScrub(() => fn) : undefined}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <ReadingPanel refData={current} active hl={search.hl} oh={search.oh} oe={search.oe} />
        </div>
      )}
    </>
  )
}
