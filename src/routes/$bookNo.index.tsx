import { createFileRoute, notFound } from '@tanstack/react-router'
import { BOOK_BY_NO } from '@/data/canon'

// The book outline. Loader-only: the /$bookNo layout's ReadingPager renders the
// content (an OutlineView panel) from the URL ref; this route just validates.
export const Route = createFileRoute('/$bookNo/')({
  // ?oe= is the outline entry to scroll to (ChapterView links here with it).
  validateSearch: (search: Record<string, unknown>): { oe?: string } => ({
    oe: typeof search.oe === 'string' ? search.oe : undefined,
  }),
  loader: ({ params }) => {
    if (!BOOK_BY_NO.has(params.bookNo)) throw notFound()
  },
  component: () => null,
})
