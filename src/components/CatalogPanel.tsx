import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CANON, type CanonBook } from '@/data/canon'
import { BOOK_ABBREV } from '@/data/abbrev'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const COLS = 5
const OT_BOOKS = CANON.filter((b) => b.testament === 'OT')
const NT_BOOKS = CANON.filter((b) => b.testament === 'NT')

function chunkRows<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += COLS) out.push(items.slice(i, i + COLS))
  return out
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isMobile
}

interface SharedProps {
  activeBookNo: number | null
  activeChapterNo: number | null
  activeBook: CanonBook | null
  /** Fires when the user taps a chapter link or the 綱目 link — lets the
   * mobile drawer close itself snappily. */
  onPick?: () => void
}

// Two-pane catalog: books on the left, chapters on the right. Mobile uses a
// custom transform-based swipe (so a snap settle animation never locks
// vertical pane scroll the way native scroll-snap can on iOS). Desktop just
// renders both panes side-by-side in the wider aside — no swipe needed.
export function CatalogPanel(props: SharedProps) {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileCatalog {...props} />
  return <DesktopCatalog {...props} />
}

function DesktopCatalog({ activeBookNo, activeChapterNo, activeBook, onPick }: SharedProps) {
  return (
    <div className="relative flex h-full">
      <div className="w-1/2 overflow-y-auto">
        <BookPicker activeBookNo={activeBookNo} />
      </div>
      <div className="w-1/2 overflow-y-auto">
        {activeBook && (
          <ChapterPicker
            book={activeBook}
            activeChapterNo={activeChapterNo}
            onPick={onPick}
          />
        )}
      </div>
      {/* Absolutely-positioned divider so it doesn't subtract from either
        * pane's content width — a `border-r` on one pane would shrink its
        * content by 1px and offset its grid cells from the other side's. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 -ml-px w-px bg-border" />
    </div>
  )
}

function MobileCatalog({ activeBookNo, activeChapterNo, activeBook, onPick }: SharedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [paneIdx, setPaneIdx] = useState<0 | 1>(activeBook ? 1 : 0)
  const isFirstRender = useRef(true)
  // Stable so the memoized BookPicker doesn't re-render every time we
  // commit a new paneIdx (which would force its 66 Tooltips to rebuild).
  const handlePickBook = useCallback(() => setPaneIdx(1), [])

  // Apply the committed transform whenever the active pane changes. First
  // render is instant (drawer opens already on the right pane when a book is
  // active); later changes animate so the swipe is visible.
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    inner.style.transition = isFirstRender.current ? 'none' : 'transform 200ms ease-out'
    inner.style.transform = `translateX(${-paneIdx * 50}%)`
    isFirstRender.current = false
  }, [paneIdx])

  // Auto-snap to the chapter pane whenever the active book / chapter changes
  // (user picked a new book — either from the book pane here or some other
  // path that hit the same URL).
  useLayoutEffect(() => {
    if (!activeBookNo) return
    setPaneIdx(1)
  }, [activeBookNo, activeChapterNo])

  // Custom touch swipe — gives us a free hand to allow vertical pane scroll
  // even while the horizontal commit animation is still running. Native
  // scroll-snap couldn't do that on iOS: its settle animation captured touch
  // input on the horizontal axis and blocked vertical scroll until done.
  useEffect(() => {
    const el = containerRef.current
    const inner = innerRef.current
    if (!el || !inner) return

    let startX = 0
    let startY = 0
    let startPct = 0
    let startTime = 0
    let mode: 'idle' | 'horizontal' | 'vertical' = 'idle'
    let lastDx = 0

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      startTime = performance.now()
      mode = 'idle'
      lastDx = 0
      // Freeze whatever animation is mid-flight, capture the current visual
      // position so drag continues from where the finger lands rather than
      // from the committed paneIdx (which might still be the previous pane).
      startPct = -paneIdx * 50
      inner.style.transition = 'none'
    }

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY

      if (mode === 'idle') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Bias toward vertical so a near-diagonal stays a page scroll.
        mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical'
      }

      if (mode === 'horizontal') {
        e.preventDefault()
        const w = el.clientWidth
        if (w === 0) return
        let pct = startPct + (dx / w) * 50
        pct = Math.max(-50, Math.min(0, pct))
        inner.style.transform = `translateX(${pct}%)`
        lastDx = dx
      }
      // Vertical: don't intercept — pane's own overflow-y handles it.
    }

    const onEnd = () => {
      if (mode === 'horizontal') {
        const w = el.clientWidth
        // Either a slow drag past 10% of the width OR a quick flick over
        // 0.3px/ms commits the swap — gives the "light flick" feel without
        // forcing the user to drag the whole pane across.
        const distanceThreshold = w * 0.1
        const dt = Math.max(performance.now() - startTime, 1)
        const velocity = lastDx / dt
        const velocityThreshold = 0.3
        let newIdx: 0 | 1 = paneIdx
        if (lastDx < -distanceThreshold || velocity < -velocityThreshold) newIdx = 1
        else if (lastDx > distanceThreshold || velocity > velocityThreshold) newIdx = 0
        inner.style.transition = 'transform 200ms ease-out'
        inner.style.transform = `translateX(${-newIdx * 50}%)`
        if (newIdx !== paneIdx) setPaneIdx(newIdx)
      }
      mode = 'idle'
      lastDx = 0
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [paneIdx])

  return (
    <div ref={containerRef} className="h-full overflow-hidden">
      {/* will-change + transform-gpu hint the browser to promote the inner
        * row to its own GPU layer up front, so each touchmove just retransforms
        * a composited layer instead of re-painting the underlying book/chapter
        * grids. */}
      <div ref={innerRef} className="relative flex h-full w-[200%] transform-gpu will-change-transform">
        <div className="w-1/2 shrink-0 overflow-y-auto">
          <BookPicker
            activeBookNo={activeBookNo}
            onPickBook={handlePickBook}
          />
        </div>
        <div className="w-1/2 shrink-0 overflow-y-auto">
          {activeBook && (
            <ChapterPicker
              book={activeBook}
              activeChapterNo={activeChapterNo}
              onPick={onPick}
            />
          )}
        </div>
        {/* Divider rides on the inner wrapper so it follows the translate —
          * sits exactly at the pane boundary, which is offscreen when one
          * pane fills the container and visible only mid-swipe. */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 -ml-px w-px bg-border" />
      </div>
    </div>
  )
}

const BookPicker = memo(function BookPicker({
  activeBookNo,
  onPickBook,
}: {
  activeBookNo: number | null
  onPickBook?: () => void
}) {
  return (
    <>
      <AccordionHeader
        label="舊約"
        stickyCls="sticky top-0 bottom-14 md:bottom-9"
        anchorCls="scroll-mt-0"
      />
      <BookSection books={OT_BOOKS} activeBookNo={activeBookNo} onPickBook={onPickBook} />
      <AccordionHeader
        label="新約"
        topBorder
        stickyCls="sticky top-[calc(3.5rem-1px)] md:top-[calc(2.25rem-1px)] bottom-0"
        anchorCls="scroll-mt-[calc(3.5rem-1px)] md:scroll-mt-[calc(2.25rem-1px)]"
      />
      <BookSection books={NT_BOOKS} activeBookNo={activeBookNo} onPickBook={onPickBook} />
    </>
  )
})

const ChapterPicker = memo(function ChapterPicker({
  book,
  activeChapterNo,
  onPick,
}: {
  book: CanonBook
  activeChapterNo: number | null
  onPick?: () => void
}) {
  const chapters = Array.from({ length: book.chapterCount }, (_, i) => i + 1)
  const rows = chunkRows(chapters)
  return (
    <>
      <ChapterHeader book={book} onPick={onPick} />
      {rows.map((row, i) => (
        <ChapterRow
          key={i}
          rowChapters={row}
          book={book}
          activeChapterNo={activeChapterNo}
          onPick={onPick}
        />
      ))}
    </>
  )
})

function ChapterHeader({
  book,
  onPick,
}: {
  book: CanonBook
  onPick?: () => void
}) {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-stretch justify-between border-b border-border bg-muted/80 text-sm font-semibold backdrop-blur md:h-9 md:text-xs">
      <span className="inline-flex items-center px-4 md:px-3">{book.name}</span>
      <Link
        to="/$bookNo"
        params={{ bookNo: book.bookNo }}
        onClick={onPick}
        className="inline-flex items-center px-4 font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:px-3"
      >
        綱目
      </Link>
    </div>
  )
}

function AccordionHeader({
  label,
  topBorder,
  stickyCls = 'sticky top-0',
  anchorCls = '',
}: {
  label: string
  topBorder?: boolean
  /** Tailwind sticky-position classes. Pass both top-… and bottom-… utilities
   * so the header stacks at the top when its natural position is above the
   * viewport and at the bottom when it's below — both ends always visible. */
  stickyCls?: string
  /** scroll-margin-top utilities for the anchor div that mirror the sticky
   * top inset. scrollIntoView is called on this anchor (NOT the sticky button)
   * because the browser reads sticky elements' currently-stuck box position
   * as "where they are" — so clicking a bottom-stuck or top-stuck button gives
   * the wrong delta. The anchor sits at the natural flow position with no
   * sticky transform, so its position is unambiguous. */
  anchorCls?: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={anchorRef} aria-hidden className={cn('h-0', anchorCls)} />
      <button
        type="button"
        onClick={() => anchorRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })}
        className={cn(
          stickyCls,
          'z-10 flex h-14 w-full items-center justify-between border-b border-border bg-muted/80 px-4 text-sm font-semibold backdrop-blur transition-colors hover:bg-muted md:h-9 md:px-3 md:text-xs',
          topBorder && 'border-t',
        )}
      >
        <span>{label}</span>
      </button>
    </>
  )
}

function BookSection({
  books,
  activeBookNo,
  onPickBook,
}: {
  books: CanonBook[]
  activeBookNo: number | null
  onPickBook?: () => void
}) {
  const rows = chunkRows(books)
  // -mb-px overlaps the last row's border-b with the next AccordionHeader's
  // border-t so the boundary reads as a single 1px line instead of stacking
  // to 2px.
  return (
    <TooltipProvider delay={0}>
      <div className="-mb-px">
        {rows.map((row, i) => (
          <BookRow
            key={i}
            rowBooks={row}
            activeBookNo={activeBookNo}
            onPickBook={onPickBook}
          />
        ))}
      </div>
    </TooltipProvider>
  )
}

function BookRow({
  rowBooks,
  activeBookNo,
  onPickBook,
}: {
  rowBooks: CanonBook[]
  activeBookNo: number | null
  onPickBook?: () => void
}) {
  return (
    <div className="grid grid-cols-5">
      {rowBooks.map((b, col) => (
        <BookGridCell
          key={b.bookNo}
          book={b}
          active={activeBookNo === b.bookNo}
          isLastCol={col === COLS - 1}
          onPick={onPickBook}
        />
      ))}
    </div>
  )
}

function BookGridCell({
  book,
  active,
  isLastCol,
  onPick,
}: {
  book: CanonBook
  active: boolean
  isLastCol: boolean
  onPick?: () => void
}) {
  const abbrev = BOOK_ABBREV[book.bookNo] ?? book.name.slice(0, 1)
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <Link
            to="/$bookNo"
            params={{ bookNo: book.bookNo }}
            onClick={onPick}
            className={cn(
              '@container flex aspect-square items-center justify-center border-b border-border transition-colors',
              !isLastCol && 'border-r',
              active
                ? 'bg-secondary text-secondary-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          />
        }
      >
        <span className="text-[clamp(0.75rem,35cqw,1.25rem)]">{abbrev}</span>
      </TooltipTrigger>
      <TooltipContent>{book.name}</TooltipContent>
    </Tooltip>
  )
}

function ChapterRow({
  rowChapters,
  book,
  activeChapterNo,
  onPick,
}: {
  rowChapters: number[]
  book: CanonBook
  activeChapterNo: number | null
  onPick?: () => void
}) {
  return (
    <div className="grid grid-cols-5">
      {rowChapters.map((ch, col) => (
        <Link
          key={ch}
          to="/$bookNo/$chapterNo"
          params={{ bookNo: book.bookNo, chapterNo: ch }}
          search={{}}
          onClick={onPick}
          className={cn(
            '@container flex aspect-square items-center justify-center border-b border-border transition-colors',
            col !== COLS - 1 && 'border-r',
            activeChapterNo === ch
              ? 'bg-secondary text-secondary-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <span className="text-[clamp(0.75rem,35cqw,1.25rem)]">{ch}</span>
        </Link>
      ))}
    </div>
  )
}
