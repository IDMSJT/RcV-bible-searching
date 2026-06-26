import { createFileRoute, notFound } from '@tanstack/react-router'
import { BOOK_BY_NO } from '@/data/canon'

// The book outline. Loader-only: the /$bookNo layout's ReadingPager renders the
// content (an OutlineView panel) from the URL ref; this route just validates.
export const Route = createFileRoute('/$bookNo/')({
  loader: ({ params }) => {
    if (!BOOK_BY_NO.has(params.bookNo)) throw notFound()
  },
  component: () => null,
})
