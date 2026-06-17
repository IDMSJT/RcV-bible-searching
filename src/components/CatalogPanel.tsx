import { useEffect, useRef, useState } from 'react'
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
import { cn } from '@/lib/utils'

const COLS = 5
const OT_BOOKS = CANON.filter((b) => b.testament === 'OT')
const NT_BOOKS = CANON.filter((b) => b.testament === 'NT')

function chunkRows<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += COLS) out.push(items.slice(i, i + COLS))
  return out
}

export function CatalogPanel({
  activeBookNo,
  activeChapterNo,
  activeBook,
  onPick,
}: {
  activeBookNo: number | null
  activeChapterNo: number | null
  activeBook: CanonBook | null
  /** Fires when the user taps a chapter link or the 綱目 link in the chapter
   * picker — lets the mobile drawer close itself snappily. */
  onPick?: () => void
}) {
  // Two-level drill-down: book picker → chapter picker.
  // The chapter picker is the default whenever a book is active (which matches
  // the user's current reading state — the index route redirects "/" to "/1/1"
  // so there is always one). Tapping back flips this local override on so the
  // user can switch books; picking a different book (or chapter) changes the
  // path, which resets the override and re-snaps to the new book's chapters.
  const [showBooks, setShowBooks] = useState(false)
  useEffect(() => {
    setShowBooks(false)
  }, [activeBookNo, activeChapterNo])

  if (activeBook && !showBooks) {
    return (
      <ChapterPicker
        book={activeBook}
        activeChapterNo={activeChapterNo}
        onPick={onPick}
        onBack={() => setShowBooks(true)}
      />
    )
  }
  return <BookPicker activeBookNo={activeBookNo} />
}

function BookPicker({ activeBookNo }: { activeBookNo: number | null }) {
  return (
    <>
      <AccordionHeader
        label="舊約"
        stickyCls="sticky top-0 bottom-14 md:bottom-9"
        anchorCls="scroll-mt-0"
      />
      <BookSection books={OT_BOOKS} activeBookNo={activeBookNo} />
      <AccordionHeader
        label="新約"
        topBorder
        stickyCls="sticky top-14 md:top-9 bottom-0"
        anchorCls="scroll-mt-14 md:scroll-mt-9"
      />
      <BookSection books={NT_BOOKS} activeBookNo={activeBookNo} />
    </>
  )
}

function ChapterPicker({
  book,
  activeChapterNo,
  onPick,
  onBack,
}: {
  book: CanonBook
  activeChapterNo: number | null
  onPick?: () => void
  onBack: () => void
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
}

function ChapterHeader({
  book,
  onPick,
  onBack,
}: {
  book: CanonBook
  onPick?: () => void
  onBack: () => void
}) {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-stretch justify-between border-b border-border bg-muted/80 text-sm font-semibold backdrop-blur md:h-9 md:text-xs">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回書卷選擇"
        className="inline-flex items-center px-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:px-3"
      >
        <ChevronLeft className="size-4 md:size-3.5" />
      </button>
      <span className="inline-flex items-center">{book.name}</span>
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
}: {
  books: CanonBook[]
  activeBookNo: number | null
}) {
  const rows = chunkRows(books)
  // -mb-px overlaps the last row's border-b with the next AccordionHeader's
  // border-t so the boundary reads as a single 1px line instead of stacking
  // to 2px.
  return (
    <TooltipProvider delay={0}>
      <div className="-mb-px">
        {rows.map((row, i) => (
          <BookRow key={i} rowBooks={row} activeBookNo={activeBookNo} />
        ))}
      </div>
    </TooltipProvider>
  )
}

function BookRow({
  rowBooks,
  activeBookNo,
}: {
  rowBooks: CanonBook[]
  activeBookNo: number | null
}) {
  return (
    <div className="grid grid-cols-5">
      {rowBooks.map((b, col) => (
        <BookGridCell
          key={b.bookNo}
          book={b}
          active={activeBookNo === b.bookNo}
          isLastCol={col === COLS - 1}
        />
      ))}
    </div>
  )
}

function BookGridCell({
  book,
  active,
  isLastCol,
}: {
  book: CanonBook
  active: boolean
  isLastCol: boolean
}) {
  const abbrev = BOOK_ABBREV[book.bookNo] ?? book.name.slice(0, 1)
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <Link
            to="/$bookNo"
            params={{ bookNo: book.bookNo }}
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
