import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BOOK_BY_NO } from '@/data/canon'
import { ChapterView } from '@/components/ChapterView'
import { cn } from '@/lib/utils'

interface ChapterSearch {
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
  | { kind: 'chapter'; bookNo: number; chapterNo: number }
  | { kind: 'outline'; bookNo: number }
  | null

function ArrowLink({ target, children }: { target: NavTarget; children: React.ReactNode }) {
  const cls = cn(
    'inline-flex size-9 items-center justify-center rounded-md',
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
      search={{}}
      className={cls}
    >
      {children}
    </Link>
  )
}

function parseHighlight(hl: string | undefined): { start?: number; end?: number } {
  if (!hl) return {}
  const m = hl.match(/^(\d+)(?:-(\d+))?$/)
  if (!m) return {}
  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : start
  return { start, end }
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

  // Chapter 1's previous page is the book outline (which sits before chapter 1).
  const prev: NavTarget =
    chapterNo > 1
      ? { kind: 'chapter', bookNo, chapterNo: chapterNo - 1 }
      : { kind: 'outline', bookNo }
  const next: NavTarget =
    chapterNo < book.chapterCount ? { kind: 'chapter', bookNo, chapterNo: chapterNo + 1 } : null
  const { start, end } = parseHighlight(hl)
  const headingAnchor = parseHeadingAnchor(oh)

  return (
    <ChapterView
      bookNo={bookNo}
      chapterNo={chapterNo}
      highlightStart={start}
      highlightEnd={end}
      headingAnchor={headingAnchor}
      leftAction={
        <ArrowLink target={prev}>
          <ChevronLeft className="size-4" />
        </ArrowLink>
      }
      rightAction={
        <ArrowLink target={next}>
          <ChevronRight className="size-4" />
        </ArrowLink>
      }
    />
  )
}
