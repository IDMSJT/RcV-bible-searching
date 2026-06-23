import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BOOK_BY_NO } from '@/data/canon'
import { ChapterView } from '@/components/ChapterView'
import { parseHighlight, carryHlForChapter } from '@/lib/highlight'
import { cn } from '@/lib/utils'

interface ChapterSearch {
  /** Comma-separated highlight list. Each item is either a verse range
   * (「13」, 「13-15」) or a note reference (「13:1」 = verse 13 note 1). Note
   * refs both auto-expand and tint the body, verse refs just tint the verse. */
  hl?: string
  /** Outline-heading anchor to highlight: "verse" or "verse.segment". */
  oh?: string
}

export const Route = createFileRoute('/$bookNo/$chapterNo')({
  validateSearch: (search: Record<string, unknown>): ChapterSearch => ({
    hl: typeof search.hl === 'string' ? search.hl : undefined,
    oh: typeof search.oh === 'string' ? search.oh : undefined,
  }),
  parseParams: (raw) => ({
    bookNo: Number(raw.bookNo),
    chapterNo: Number(raw.chapterNo),
  }),
  stringifyParams: (p) => ({
    bookNo: String(p.bookNo),
    chapterNo: String(p.chapterNo),
  }),
  loader: ({ params }) => {
    const book = BOOK_BY_NO.get(params.bookNo)
    if (!book) throw notFound()
    if (params.chapterNo < 1 || params.chapterNo > book.chapterCount) throw notFound()
    return { book }
  },
  component: ChapterPage,
})

type NavTarget =
  // `hl` carries a cross-chapter range forward so paging into it keeps the
  // highlight; undefined clears hl (the normal case).
  | { kind: 'chapter'; bookNo: number; chapterNo: number; hl?: string }
  | { kind: 'outline'; bookNo: number }
  | null

function ArrowLink({ target, children }: { target: NavTarget; children: React.ReactNode }) {
  const cls = cn(
    'inline-flex size-7 items-center justify-center rounded-md',
    target
      ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
      : 'text-muted-foreground/40 pointer-events-none',
  )
  if (!target) return <span className={cls}>{children}</span>
  if (target.kind === 'outline') {
    return (
      <Link to="/$bookNo" params={{ bookNo: target.bookNo }} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <Link
      to="/$bookNo/$chapterNo"
      params={{ bookNo: target.bookNo, chapterNo: target.chapterNo }}
      search={target.hl ? { hl: target.hl } : {}}
      className={cls}
    >
      {children}
    </Link>
  )
}


function parseHeadingAnchor(oh: string | undefined): { verse: number; segment: number } | undefined {
  if (!oh) return undefined
  const m = oh.match(/^(\d+)(?:\.(\d+))?$/)
  if (!m) return undefined
  return { verse: Number(m[1]), segment: m[2] ? Number(m[2]) : 0 }
}

function ChapterPage() {
  const { bookNo, chapterNo } = Route.useParams()
  const { hl, oh } = Route.useSearch()
  const { book } = Route.useLoaderData()

  const highlights = parseHighlight(hl)
  const headingAnchor = parseHeadingAnchor(oh)

  // The linear reading sequence is: [book1 outline, book1 ch1, …, book1 chN,
  // book2 outline, book2 ch1, …]. So chapter 1's prev is the same book's
  // outline, and the last chapter's next is the *following* book's outline
  // (only nullable when we run off the end at Revelation). Adjacent in-book
  // chapters carry forward any cross-chapter range that still covers them, so
  // a 十一27～十二37 highlight keeps tinting as you page from ch11 into ch12.
  const prev: NavTarget =
    chapterNo > 1
      ? { kind: 'chapter', bookNo, chapterNo: chapterNo - 1, hl: carryHlForChapter(highlights, chapterNo - 1) }
      : { kind: 'outline', bookNo }
  const next: NavTarget =
    chapterNo < book.chapterCount
      ? { kind: 'chapter', bookNo, chapterNo: chapterNo + 1, hl: carryHlForChapter(highlights, chapterNo + 1) }
      : BOOK_BY_NO.has(bookNo + 1)
        ? { kind: 'outline', bookNo: bookNo + 1 }
        : null

  return (
    <ChapterView
      bookNo={bookNo}
      chapterNo={chapterNo}
      highlights={highlights}
      headingAnchor={headingAnchor}
      leftAction={
        <ArrowLink target={prev}>
          <ChevronLeft className="size-3.5" />
        </ArrowLink>
      }
      rightAction={
        <ArrowLink target={next}>
          <ChevronRight className="size-3.5" />
        </ArrowLink>
      }
    />
  )
}
