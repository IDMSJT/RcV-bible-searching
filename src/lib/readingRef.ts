import { BOOK_BY_NO } from '@/data/canon'

/**
 * A single page in the reading sequence. The canon reads as one linear list:
 *   [book1 outline, book1 ch1 … book1 chN, book2 outline, book2 ch1, …]
 * so an outline always precedes its book's chapters. This is the unit the
 * reading carousel pages over — the single source of truth for prev/next.
 */
export type ReadingRef =
  | { kind: 'outline'; bookNo: number }
  | { kind: 'chapter'; bookNo: number; chapterNo: number }

/** The page before `ref` in the reading sequence, or null at Genesis' outline. */
export function prevRef(ref: ReadingRef): ReadingRef | null {
  if (ref.kind === 'chapter') {
    // ch1's prev is this book's outline; otherwise the previous chapter.
    return ref.chapterNo > 1
      ? { kind: 'chapter', bookNo: ref.bookNo, chapterNo: ref.chapterNo - 1 }
      : { kind: 'outline', bookNo: ref.bookNo }
  }
  // An outline's prev is the previous book's last chapter.
  const prevBook = BOOK_BY_NO.get(ref.bookNo - 1)
  return prevBook ? { kind: 'chapter', bookNo: prevBook.bookNo, chapterNo: prevBook.chapterCount } : null
}

/** The page after `ref`, or null past Revelation's last chapter. */
export function nextRef(ref: ReadingRef): ReadingRef | null {
  if (ref.kind === 'outline') {
    return { kind: 'chapter', bookNo: ref.bookNo, chapterNo: 1 }
  }
  const book = BOOK_BY_NO.get(ref.bookNo)
  if (!book) return null
  if (ref.chapterNo < book.chapterCount) {
    return { kind: 'chapter', bookNo: ref.bookNo, chapterNo: ref.chapterNo + 1 }
  }
  // Last chapter → the next book's outline (null at the end of the canon).
  return BOOK_BY_NO.has(ref.bookNo + 1) ? { kind: 'outline', bookNo: ref.bookNo + 1 } : null
}

/** Stable identity string for a ref (keys, comparisons, swipe reset). */
export function refKey(ref: ReadingRef): string {
  return ref.kind === 'outline' ? `o/${ref.bookNo}` : `c/${ref.bookNo}/${ref.chapterNo}`
}
