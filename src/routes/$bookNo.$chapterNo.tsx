import { createFileRoute, notFound } from '@tanstack/react-router'
import { BOOK_BY_NO } from '@/data/canon'

interface ChapterSearch {
  /** Comma-separated highlight list (verse ranges / note refs). */
  hl?: string
  /** Outline-heading anchor to highlight: "verse" or "verse.segment". */
  oh?: string
}

// A chapter. Loader-only: the /$bookNo layout's ReadingPager renders the
// content (a ChapterView panel) from the URL ref; this route just validates and
// owns the hl/oh search params.
export const Route = createFileRoute('/$bookNo/$chapterNo')({
  validateSearch: (search: Record<string, unknown>): ChapterSearch => ({
    hl: typeof search.hl === 'string' ? search.hl : undefined,
    oh: typeof search.oh === 'string' ? search.oh : undefined,
  }),
  // bookNo is parsed by the parent /$bookNo route and inherited here.
  parseParams: (raw) => ({ chapterNo: Number(raw.chapterNo) }),
  stringifyParams: (p) => ({ chapterNo: String(p.chapterNo) }),
  loader: ({ params }) => {
    const book = BOOK_BY_NO.get(params.bookNo)
    if (!book) throw notFound()
    if (params.chapterNo < 1 || params.chapterNo > book.chapterCount) throw notFound()
  },
  component: () => null,
})
