import { createFileRoute } from '@tanstack/react-router'
import { ReadingPager } from '@/components/ReadingPager'

/**
 * Layout for everything under /$bookNo (the book outline and its chapters). It
 * stays mounted across every chapter / outline / cross-book navigation (only
 * the params change), so the reading carousel can page without remounting. It
 * renders the pager directly and reads the active ref from the URL; the child
 * routes are loader-only (validation) and render nothing themselves.
 */
export const Route = createFileRoute('/$bookNo')({
  // The $bookNo param lives on this parent; children parse only their own
  // segment (chapterNo / nothing) and inherit bookNo.
  parseParams: (raw) => ({ bookNo: Number(raw.bookNo) }),
  stringifyParams: (p) => ({ bookNo: String(p.bookNo) }),
  component: ReadingPager,
})
