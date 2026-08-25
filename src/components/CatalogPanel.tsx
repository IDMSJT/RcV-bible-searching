import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { CANON, type CanonBook } from '@/data/canon'
import { BOOK_ABBREV } from '@/data/abbrev'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

const COLS = 5
const OT_BOOKS = CANON.filter((b) => b.testament === 'OT')
const NT_BOOKS = CANON.filter((b) => b.testament === 'NT')

function chunkRows<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += COLS) out.push(items.slice(i, i + COLS))
  return out
}

interface SharedProps {
  activeBookNo: number | null
  activeChapterNo: number | null
  activeBook: CanonBook | null
  /** Fires when the user taps a chapter link or the 綱目 link — lets the
   * mobile drawer close itself snappily. */
  onPick?: () => void
  /** Mobile only: which pane is showing (0 = books, 1 = chapters). Controlled
   * from __root so the bottom-nav button can cycle it. Desktop shows both. */
  pane?: 0 | 1
  onPaneChange?: (pane: 0 | 1) => void
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

// Each pane's last scroll offset. Module-level because the drawer unmounts its
// contents on close, so component state wouldn't survive between openings.
const paneScroll = { books: 0, chapters: 0 }

function MobileCatalog({
  activeBookNo,
  activeChapterNo,
  activeBook,
  onPick,
  pane,
  onPaneChange,
}: SharedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const bookPaneRef = useRef<HTMLDivElement>(null)
  const chapterPaneRef = useRef<HTMLDivElement>(null)
  // Controlled by __root (falls back to a sensible default if used standalone),
  // so the bottom-nav button and the swipe drive the same pane.
  const paneIdx: 0 | 1 = pane ?? (activeBook ? 1 : 0)
  const setPaneIdx = useCallback((p: 0 | 1) => onPaneChange?.(p), [onPaneChange])
  const isFirstRender = useRef(true)
  // Stable so the memoized BookPicker doesn't re-render every time the pane
  // commits (which would force its 66 Tooltips to rebuild).
  const handlePickBook = useCallback(() => setPaneIdx(1), [setPaneIdx])
  const handleBackToBooks = useCallback(() => setPaneIdx(0), [setPaneIdx])

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

  // Reopening the catalog should land where it was left — you were probably
  // browsing towards something. But a link may have moved the reader elsewhere
  // in the meantime, so if where they now are isn't on screen, centre it: on
  // 詩篇130 the catalog should show 130, not the top of a 150-cell grid.
  // Scroll is written straight to the pane rather than via scrollIntoView,
  // which would also try to scroll the drawer and the page behind it.
  useLayoutEffect(() => {
    const panes = [
      [bookPaneRef.current, 'books'],
      [chapterPaneRef.current, 'chapters'],
    ] as const
    for (const [pane, key] of panes) {
      if (!pane) continue
      pane.scrollTop = paneScroll[key]
      const el = pane.querySelector<HTMLElement>('[data-active]')
      if (!el) continue
      const p = pane.getBoundingClientRect()
      const e = el.getBoundingClientRect()
      if (e.top < p.top || e.bottom > p.bottom) {
        pane.scrollTop += e.top - p.top - (pane.clientHeight - el.offsetHeight) / 2
      }
    }
    return () => {
      for (const [pane, key] of panes) {
        if (pane) paneScroll[key] = pane.scrollTop
      }
    }
  }, [activeBookNo, activeChapterNo])

  // Auto-snap to the chapter pane whenever the active book / chapter changes
  // (user picked a new book — either from the book pane here or some other
  // path that hit the same URL).
  useLayoutEffect(() => {
    if (!activeBookNo) return
    setPaneIdx(1)
  }, [activeBookNo, activeChapterNo, setPaneIdx])

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
  }, [paneIdx, setPaneIdx])

  return (
    <div ref={containerRef} className="h-full overflow-hidden">
      {/* will-change + transform-gpu hint the browser to promote the inner
        * row to its own GPU layer up front, so each touchmove just retransforms
        * a composited layer instead of re-painting the underlying book/chapter
        * grids. */}
      <div ref={innerRef} className="relative flex h-full w-[200%] transform-gpu will-change-transform">
        <div ref={bookPaneRef} className="w-1/2 shrink-0 overflow-y-auto">
          <BookPicker
            activeBookNo={activeBookNo}
            onPickBook={handlePickBook}
          />
        </div>
        <div ref={chapterPaneRef} className="w-1/2 shrink-0 overflow-y-auto">
          {activeBook && (
            <ChapterPicker
              book={activeBook}
              activeChapterNo={activeChapterNo}
              onPick={onPick}
              onBack={handleBackToBooks}
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
        stickyCls="sticky top-0 bottom-[var(--header-h)] md:bottom-9"
        anchorCls="scroll-mt-0"
      />
      <BookSection books={OT_BOOKS} activeBookNo={activeBookNo} onPickBook={onPickBook} />
      <AccordionHeader
        label="新約"
        topBorder
        stickyCls="sticky top-[calc(var(--header-h)-1px)] md:top-[calc(2.25rem-1px)] bottom-0"
        anchorCls="scroll-mt-[calc(var(--header-h)-1px)] md:scroll-mt-[calc(2.25rem-1px)]"
      />
      <BookSection books={NT_BOOKS} activeBookNo={activeBookNo} onPickBook={onPickBook} />
    </>
  )
})

const ChapterPicker = memo(function ChapterPicker({
  book,
  activeChapterNo,
  onPick,
  onBack,
}: {
  book: CanonBook
  activeChapterNo: number | null
  onPick?: () => void
  /** When provided, the header renders a back arrow that jumps the user back
   * to the book pane — mobile only, since desktop shows both panes at once. */
  onBack?: () => void
}) {
  const chapters = Array.from({ length: book.chapterCount }, (_, i) => i + 1)
  const rows = chunkRows(chapters)
  return (
    <>
      <ChapterHeader book={book} onPick={onPick} onBack={onBack} />
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

// Three columns, but they earn their widths differently per viewport. On mobile
// the back arrow holds the left slot and the book name is centred, so the outer
// columns have to match. Desktop has no back arrow — the name sits left and
// wants every pixel the right column doesn't, otherwise a long one like
// 帖撒羅尼迦前書 wraps to two lines while 綱目 sits in space it never needed.
function ChapterHeader({
  book,
  onPick,
  onBack,
}: {
  book: CanonBook
  onPick?: () => void
  onBack?: () => void
}) {
  return (
    <div className="sticky top-0 z-10 grid h-[var(--header-h)] grid-cols-[1fr_auto_1fr] items-stretch border-b border-border bg-muted/80 text-base font-medium backdrop-blur md:h-9 md:grid-cols-[1fr_auto_auto] md:text-xs md:font-semibold">
      <div className="flex items-stretch">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="返回書卷選擇"
            className="inline-flex items-center px-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-5 [stroke-width:1.8]" />
          </button>
        ) : (
          <span className="inline-flex items-center px-4">{book.name}</span>
        )}
      </div>
      {/* Centred only when drilled in (the back arrow holds the left slot); at
       * top level the name lives in the left slot above and this stays empty. */}
      <span className="self-center">{onBack ? book.name : null}</span>
      <div className="flex items-stretch justify-end">
        <Link
          to="/$bookNo"
          params={{ bookNo: book.bookNo }}
          onClick={onPick}
          className="inline-flex items-center px-4 font-medium text-primary transition-colors hover:bg-muted"
        >
          綱目
        </Link>
      </div>
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
          'z-10 flex h-[var(--header-h)] w-full items-center justify-between border-b border-border bg-muted/80 px-4 text-base font-medium backdrop-blur transition-colors hover:bg-muted md:h-9 md:text-xs md:font-semibold',
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
            // Lets the pane find what to bring into view when it opens.
            data-active={active || undefined}
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
          data-active={activeChapterNo === ch || undefined}
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
