import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { CHARTS } from '@/data/charts'
import { CANON, BOOK_BY_NO, type CanonBook } from '@/data/canon'
import { BOOK_ABBREV } from '@/data/abbrev'
import { chapterUnit, toChineseNumber } from '@/lib/chinese'
import type { Visit } from '@/lib/readingHistory'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { COMMIT_MS } from '@/lib/useCarousel'
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
  /** Put the drawer away without going anywhere (tapping the chapter you are
   * already on). Links dismiss it themselves: the drawer is a search param, and
   * a link without it takes the param out. */
  onDismiss?: () => void
  /** The phone's drawer is up. Its links replace the drawer's history entry
   * rather than stack on it, so back from the page they open skips over it —
   * except charts, which push, so back from one returns to the list. */
  inDrawer?: boolean
  /** Mobile only: which pane is showing (0 = books, 1 = chapters, 2 = charts). Controlled
   * from __root so the bottom-nav button can cycle it. Desktop shows both. */
  pane?: 0 | 1 | 2
  onPaneChange?: (pane: 0 | 1 | 2) => void
  /** Chapters the reader has opened, newest first — shown by the 歷史 button in
   * the book pane's header. Swiped-past chapters aren't in it. */
  history?: Visit[]
  onRemoveHistory?: (visit: Visit) => void
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

// The 閱讀 / 圖表 switch — the same segmented pill as the search panel's. The
// indicator is positioned by whoever owns the gesture (the phone drags it along
// with the panes); `tab` is only where it rests.
function CatalogTabs({
  tab,
  onSelect,
  indicatorRef,
}: {
  tab: 0 | 1
  onSelect: (tab: 0 | 1) => void
  indicatorRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="shrink-0 px-4 pt-3 pb-1">
    <div className="relative flex overflow-hidden rounded-xl border border-border bg-background">
      <div
        ref={indicatorRef}
        aria-hidden
        className="absolute inset-y-0 left-0 z-0 w-1/2 bg-muted/40 ring-1 ring-border"
        style={{
          transform: `translateX(${tab * 100}%)`,
          transition: `transform ${COMMIT_MS}ms ease-out`,
        }}
      />
      {(['閱讀', '圖表'] as const).map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(i as 0 | 1)}
          className={cn(
            'relative z-10 flex-1 py-2.5 text-center text-sm transition-colors',
            tab === i ? 'font-medium text-foreground' : 'font-normal text-muted-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
    </div>
  )
}

function ChartsPane() {
  const { pathname } = useLocation()
  return (
    <ul className="mt-2 min-h-[calc(100%-0.5rem)]">
      {CHARTS.map((c) => (
        <li key={c.n} className="border-b border-border last:border-b-0">
          <Link
            to="/charts/$n"
            params={{ n: String(c.n) }}
            viewTransition={false}
            // Opened from a chart, the drawer's entry is the one this replaces:
            // back from the next chart should reach this one, not the drawer.
            replace={pathname.startsWith('/charts')}
            className={cn(
              'flex items-center gap-2 px-6 py-4 text-base transition-colors hover:bg-muted md:py-2.5 md:text-sm',
              pathname === `/charts/${c.n}` && 'bg-muted/40 font-medium',
            )}
          >
            <span className="w-8 shrink-0 text-muted-foreground md:w-7">圖{toChineseNumber(c.n)}</span>
            <span className="flex-1">{c.name}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function DesktopCatalog({
  activeBookNo,
  activeChapterNo,
  activeBook,
  onDismiss,
  history = [],
  onRemoveHistory,
}: SharedProps) {
  const { pathname } = useLocation()
  // Opened over a chart, it starts on the charts; the sidebar stays mounted, so
  // after that it keeps whichever the reader last chose.
  const [tab, setTab] = useState<0 | 1>(() => (pathname.startsWith('/charts') ? 1 : 0))
  return (
    <div className="flex h-full flex-col">
      <CatalogTabs tab={tab} onSelect={setTab} />
      <div className="min-h-0 flex-1">
        {tab === 1 ? (
          <div className="h-full overflow-y-auto">
            <ChartsPane />
          </div>
        ) : (
          <div className="relative flex h-full">
            <div className="w-1/2 overflow-y-auto">
              <BookPicker
                activeBookNo={activeBookNo}
                history={history}
                onRemoveHistory={onRemoveHistory}
              />
            </div>
            <div className="w-1/2 overflow-y-auto">
              {activeBook && (
                <ChapterPicker
                  book={activeBook}
                  activeChapterNo={activeChapterNo}
                  onDismiss={onDismiss}
                />
              )}
            </div>
            {/* Absolutely-positioned divider so it doesn't subtract from either
              * pane's content width — a `border-r` on one pane would shrink its
              * content by 1px and offset its grid cells from the other side's. */}
            <div className="pointer-events-none absolute top-3 bottom-0 left-1/2 z-20 -ml-px w-px bg-border" />
          </div>
        )}
      </div>
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
  onDismiss,
  inDrawer,
  pane,
  onPaneChange,
  history = [],
  onRemoveHistory,
}: SharedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const bookPaneRef = useRef<HTMLDivElement>(null)
  const chapterPaneRef = useRef<HTMLDivElement>(null)
  // Controlled by __root (it is the ?panel= param), so the bottom-nav button,
  // the swipe and the back gesture all drive the same pane.
  const paneIdx: 0 | 1 | 2 = pane ?? (activeBook ? 1 : 0)
  const setPaneIdx = useCallback((p: 0 | 1 | 2) => onPaneChange?.(p), [onPaneChange])
  const indicatorRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)
  // Stable so the memoized ChapterPicker doesn't re-render every time the pane
  // commits.
  const handleBackToBooks = useCallback(() => setPaneIdx(0), [setPaneIdx])

  // Apply the committed transform whenever the active pane changes. First
  // render is instant (drawer opens already on the right pane when a book is
  // active); later changes animate so the swipe is visible.
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    inner.style.transition = isFirstRender.current ? 'none' : 'transform 200ms ease-out'
    inner.style.transform = `translateX(${(-paneIdx * 100) / 3}%)`
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

  // Custom touch swipe — gives us a free hand to allow vertical pane scroll
  // even while the horizontal commit animation is still running. Native
  // scroll-snap couldn't do that on iOS: its settle animation captured touch
  // input on the horizontal axis and blocked vertical scroll until done.
  useEffect(() => {
    const el = containerRef.current
    const inner = innerRef.current
    const indicator = indicatorRef.current
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
      startPct = (-paneIdx * 100) / 3
      inner.style.transition = 'none'
      if (indicator) indicator.style.transition = 'none'
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
        let pct = startPct + (dx / w) * (100 / 3)
        pct = Math.max(-200 / 3, Math.min(0, pct))
        inner.style.transform = `translateX(${pct}%)`
        // The pill's indicator rides the same drag: it crosses from 閱讀 to
        // 圖表 as the strip passes from the chapters to the charts.
        if (indicator) {
          const t = Math.max(0, Math.min(1, (-pct * 3) / 100 - 1))
          indicator.style.transform = `translateX(${t * 100}%)`
        }
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
        let newIdx: 0 | 1 | 2 = paneIdx
        if (lastDx < -distanceThreshold || velocity < -velocityThreshold)
          newIdx = Math.min(2, paneIdx + 1) as 0 | 1 | 2
        else if (lastDx > distanceThreshold || velocity > velocityThreshold)
          newIdx = Math.max(0, paneIdx - 1) as 0 | 1 | 2
        inner.style.transition = `transform ${COMMIT_MS}ms ease-out`
        inner.style.transform = `translateX(${(-newIdx * 100) / 3}%)`
        if (indicator) {
          indicator.style.transition = `transform ${COMMIT_MS}ms ease-out`
          indicator.style.transform = `translateX(${newIdx === 2 ? 100 : 0}%)`
        }
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

  const tab = paneIdx === 2 ? 1 : 0
  return (
    <div className="flex h-full flex-col">
      <CatalogTabs
        tab={tab}
        indicatorRef={indicatorRef}
        onSelect={(t) => setPaneIdx(t === 1 ? 2 : paneIdx === 2 ? (activeBook ? 1 : 0) : paneIdx)}
      />
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
        {/* will-change + transform-gpu hint the browser to promote the inner
          * row to its own GPU layer up front, so each touchmove just retransforms
          * a composited layer instead of re-painting the underlying book/chapter
          * grids. */}
        <div ref={innerRef} className="relative flex h-full w-[300%] transform-gpu will-change-transform">
          <div ref={bookPaneRef} className="w-1/3 shrink-0 overflow-y-auto">
            <BookPicker
              activeBookNo={activeBookNo}
              drill
              history={history}
              replace={inDrawer}
              onRemoveHistory={onRemoveHistory}
            />
          </div>
          <div ref={chapterPaneRef} className="w-1/3 shrink-0 overflow-y-auto">
            {activeBook && (
              <ChapterPicker
                book={activeBook}
                activeChapterNo={activeChapterNo}
                onDismiss={onDismiss}
                replace={inDrawer}
                onBack={handleBackToBooks}
              />
            )}
          </div>
          <div className="w-1/3 shrink-0 overflow-y-auto">
            <ChartsPane />
          </div>
          {/* Dividers ride on the inner wrapper so they follow the translate —
            * each sits exactly at a pane boundary, offscreen when one pane fills
            * the container and visible only mid-swipe. */}
          <div className="pointer-events-none absolute top-3 bottom-0 left-1/3 z-20 -ml-px w-px bg-border" />
          <div className="pointer-events-none absolute top-3 bottom-0 left-2/3 z-20 -ml-px w-px bg-border" />
        </div>
      </div>
    </div>
  )
}

const BookPicker = memo(function BookPicker({
  activeBookNo,
  drill,
  replace,
  history = [],
  onRemoveHistory,
}: {
  activeBookNo: number | null
  /** Phone: picking a book opens its chapters in the drawer rather than closing it. */
  drill?: boolean
  replace?: boolean
  history?: Visit[]
  onRemoveHistory?: (visit: Visit) => void
}) {
  // Each header stacks at the top once its section has scrolled above the
  // viewport and at the bottom while it is still below, so all of them stay in
  // reach — which means every header's insets depend on how many sit either
  // side of it. With 歷史紀錄 present that's three deep; without it, two.
  const hasHistory = history.length > 0
  return (
    <>
      <AccordionHeader
        label="舊約"
        stickyCls={cn(
          'sticky top-0',
          hasHistory
            ? 'bottom-[calc(var(--acc-h)*2-1px)] md:bottom-[calc(4.5rem-1px)]'
            : 'bottom-[var(--acc-h)] md:bottom-9',
        )}
        anchorCls="scroll-mt-0"
      />
      <BookSection books={OT_BOOKS} activeBookNo={activeBookNo} drill={drill} />
      <AccordionHeader
        label="新約"
        topBorder
        stickyCls={cn(
          'sticky top-[calc(var(--acc-h)-1px)] md:top-[calc(2.25rem-1px)]',
          hasHistory ? 'bottom-[calc(var(--acc-h)-1px)] md:bottom-[calc(2.25rem-1px)]' : 'bottom-0',
        )}
        anchorCls="scroll-mt-[calc(var(--acc-h)-1px)] md:scroll-mt-[calc(2.25rem-1px)]"
      />
      <BookSection books={NT_BOOKS} activeBookNo={activeBookNo} drill={drill} />
      {hasHistory && (
        <>
          <AccordionHeader
            label="歷史紀錄"
            topBorder
            stickyCls="sticky top-[calc(var(--acc-h)*2-2px)] md:top-[calc(4.5rem-2px)] bottom-0"
            anchorCls="scroll-mt-[calc(var(--acc-h)*2-2px)] md:scroll-mt-[calc(4.5rem-2px)]"
          />
          <HistoryList history={history} replace={replace} onRemove={onRemoveHistory} />
        </>
      )}
    </>
  )
})

/**
 * 歷史紀錄 — the chapters the reader opened, newest first.
 *
 * The third section of the book pane, under 新約, rather than a view of its
 * own: it answers the same question the books above it do — which chapter am I
 * going to — just from where you have been instead of from the canon.
 */
function HistoryList({
  history,
  replace,
  onRemove,
}: {
  history: Visit[]
  replace?: boolean
  onRemove?: (visit: Visit) => void
}) {
  return (
    <>
      {history.map((v) => (
        // The row is a link with its own remove button beside it, not one inside
        // the other — an entry is a place to go, and dropping it is a separate
        // action on the same row.
        <div
          key={`${v.bookNo}-${v.chapterNo}`}
          className="relative flex items-stretch border-b border-border last:border-b-0"
        >
          <Link
            to="/$bookNo/$chapterNo"
            params={{ bookNo: v.bookNo, chapterNo: v.chapterNo }}
            search={{}}
            replace={replace}
            viewTransition={false}
            // pr leaves the remove button its corner; the link still runs the
            // full width beneath it, so the row reads (and highlights) as one.
            className="flex flex-1 items-baseline gap-2 py-4 pl-4 pr-12 text-base transition-colors hover:bg-muted md:py-2.5 md:text-sm"
          >
            <span className="font-medium">{BOOK_BY_NO.get(v.bookNo)?.name ?? ''}</span>
            <span className="text-muted-foreground">
              第 {v.chapterNo} {chapterUnit(v.bookNo)}
            </span>
          </Link>
          {onRemove && (
            // Laid over the link rather than inside it — an <a> can't hold a
            // <button> — so the whole row stays one link while a press on the
            // corner square is the button's alone, never the link's.
            <button
              type="button"
              onClick={() => onRemove(v)}
              aria-label="移除這筆紀錄"
              // The ::after is hit area only — it reaches 8px past the square so
              // a thumb has something to land on, without the square itself
              // growing. Collapsed on md, where a cursor doesn't need the slack
              // and the extra reach would only steal presses from the link.
              className="absolute top-1/2 right-3 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground md:after:inset-0"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
    </>
  )
}

const ChapterPicker = memo(function ChapterPicker({
  book,
  activeChapterNo,
  onDismiss,
  replace,
  onBack,
}: {
  book: CanonBook
  activeChapterNo: number | null
  onDismiss?: () => void
  replace?: boolean
  /** When provided, the header renders a back arrow that jumps the user back
   * to the book pane — mobile only, since desktop shows both panes at once. */
  onBack?: () => void
}) {
  const chapters = Array.from({ length: book.chapterCount }, (_, i) => i + 1)
  const rows = chunkRows(chapters)
  return (
    <>
      <ChapterHeader book={book} replace={replace} onBack={onBack} />
      {rows.map((row, i) => (
        <ChapterRow
          key={i}
          rowChapters={row}
          book={book}
          activeChapterNo={activeChapterNo}
          onDismiss={onDismiss}
          replace={replace}
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
  replace,
  onBack,
}: {
  book: CanonBook
  replace?: boolean
  onBack?: () => void
}) {
  return (
    <div className="sticky top-0 z-10 grid h-[var(--acc-h)] grid-cols-[1fr_auto_1fr] items-stretch border-b border-border bg-popover text-[15px] font-medium md:h-9 md:bg-background md:grid-cols-[1fr_auto_auto] md:text-xs md:font-semibold">
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
          replace={replace}
          viewTransition={false}
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
   * top inset. The scroll is measured from this anchor (NOT the sticky button)
   * because the browser reads sticky elements' currently-stuck box position
   * as "where they are" — so clicking a bottom-stuck or top-stuck button gives
   * the wrong delta. The anchor sits at the natural flow position with no
   * sticky transform, so its position is unambiguous. */
  anchorCls?: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)

  // Scroll the pane itself rather than calling scrollIntoView on the anchor:
  // that walks every scrollable ancestor, so it also dragged the drawer (and
  // the page behind it) up, taking the whole panel off screen. Writing scrollTop
  // touches only this pane, and clamping to its range means a short last section
  // simply lands at the bottom instead of trying to reach a top it can't.
  const scrollToSection = () => {
    const anchor = anchorRef.current
    if (!anchor) return
    let pane = anchor.parentElement
    while (pane) {
      const oy = getComputedStyle(pane).overflowY
      if ((oy === 'auto' || oy === 'scroll') && pane.scrollHeight > pane.clientHeight) break
      pane = pane.parentElement
    }
    if (!pane) return
    // The sticky inset this header comes to rest at, as set by anchorCls.
    const inset = parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0
    const delta = anchor.getBoundingClientRect().top - pane.getBoundingClientRect().top - inset
    const max = pane.scrollHeight - pane.clientHeight
    pane.scrollTo({ top: Math.max(0, Math.min(pane.scrollTop + delta, max)), behavior: 'smooth' })
  }

  return (
    <>
      <div ref={anchorRef} aria-hidden className={cn('h-0', anchorCls)} />
      <button
        type="button"
        onClick={scrollToSection}
        className={cn(
          stickyCls,
          'z-10 flex h-[var(--acc-h)] w-full items-center justify-center border-b border-border bg-popover px-4 text-[15px] font-medium transition-colors hover:bg-muted md:h-9 md:bg-background md:text-xs md:font-semibold',
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
  drill,
}: {
  books: CanonBook[]
  activeBookNo: number | null
  drill?: boolean
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
            drill={drill}
          />
        ))}
      </div>
    </TooltipProvider>
  )
}

function BookRow({
  rowBooks,
  activeBookNo,
  drill,
}: {
  rowBooks: CanonBook[]
  activeBookNo: number | null
  drill?: boolean
}) {
  return (
    <div className="grid grid-cols-5">
      {rowBooks.map((b, col) => (
        <BookGridCell
          key={b.bookNo}
          book={b}
          active={activeBookNo === b.bookNo}
          isLastCol={col === COLS - 1}
          drill={drill}
        />
      ))}
    </div>
  )
}

function BookGridCell({
  book,
  active,
  isLastCol,
  drill,
}: {
  book: CanonBook
  active: boolean
  isLastCol: boolean
  drill?: boolean
}) {
  const abbrev = BOOK_ABBREV[book.bookNo] ?? book.name.slice(0, 1)
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <Link
            to="/$bookNo"
            params={{ bookNo: book.bookNo }}
            // On the phone the drawer stays up on that book's chapters: the page
            // behind changes, the entry doesn't grow, and it carries no
            // "I opened the drawer" mark, so dismissing it later strips the
            // param instead of going back to the book it replaced.
            {...(drill ? { search: { panel: 'chapters' as const }, replace: true } : {})}
            // Lets the pane find what to bring into view when it opens.
            data-active={active || undefined}
            className={cn(
              '@container flex aspect-square items-center justify-center border-b border-border transition-colors',
              !isLastCol && 'border-r',
              active
                ? 'bg-muted/40 text-foreground font-medium'
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
  onDismiss,
  replace,
}: {
  rowChapters: number[]
  book: CanonBook
  activeChapterNo: number | null
  onDismiss?: () => void
  replace?: boolean
}) {
  const { pathname } = useLocation()
  return (
    <div className="grid grid-cols-5">
      {rowChapters.map((ch, col) => {
        const active = activeChapterNo === ch
        // Marked as where the reader left off, but not necessarily where they
        // are: from a chart page it is still a way back, not a place to stay.
        const here = active && pathname === `/${book.bookNo}/${ch}`
        // data-active marks the cell the pane centres on when it opens.
        const cellProps = {
          'data-active': active || undefined,
          className: cn(
            '@container flex aspect-square items-center justify-center border-b border-border transition-colors',
            col !== COLS - 1 && 'border-r',
            active
              ? 'bg-muted/40 text-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ),
        }
        const label = <span className="text-[clamp(0.75rem,35cqw,1.25rem)]">{ch}</span>
        // The chapter you're already on is nowhere to go: routing to the page
        // you're on still re-commits and repaints the reading surface under the
        // closing drawer, which read as a flicker. Just put the drawer away.
        return here ? (
          <button key={ch} type="button" onClick={onDismiss} {...cellProps}>
            {label}
          </button>
        ) : (
          <Link
            key={ch}
            to="/$bookNo/$chapterNo"
            params={{ bookNo: book.bookNo, chapterNo: ch }}
            search={{}}
            replace={replace}
            // The drawer sliding away is the transition. A cross-fade on top of
            // it captures the whole page — drawer included — so the old
            // snapshot's still-open drawer ghosts over the one actually closing.
            viewTransition={false}
            {...cellProps}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
