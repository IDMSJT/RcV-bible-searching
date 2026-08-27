/** A chapter the reader opened, newest first. */
export type Visit = { bookNo: number; chapterNo: number; at: number }

export const HISTORY_KEY = 'rcv/history'

/** How many chapters back the list goes. Long enough to retrace an afternoon's
 * reading, short enough to stay scannable. */
const MAX_VISITS = 50

/**
 * Set just before a navigation that shouldn't count as a visit.
 *
 * The reading carousel pages chapter by chapter as the reader swipes, and a
 * history filled with every chapter brushed past on the way somewhere is no
 * history at all — it records where you *went*, not what you slid over. The
 * pager raises this immediately before its own navigate(); the recorder clears
 * it on the next visit it sees, so it only ever skips that one.
 */
let skipNext = false

export function skipNextVisit(): void {
  skipNext = true
}

function read(): Visit[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw !== null ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? (parsed as Visit[]) : []
  } catch {
    return []
  }
}

/**
 * The list with this chapter at its head, or null when nothing should change —
 * a suppressed swipe, or a chapter that is already the most recent entry (so
 * re-reading it, or arriving with a different ?hl, doesn't stack duplicates).
 *
 * The current list is read from storage rather than passed in, so the caller
 * needs no live copy of it to record against — one less thing to keep in sync
 * with the hook that renders it.
 *
 * An earlier visit to the same chapter moves to the front rather than appearing
 * twice: the question the list answers is "where have I been", and a chapter is
 * one answer however many times it was opened.
 */
/** The list without this chapter. Reads storage for the same reason recordVisit
 * does: the caller can then hand the setter a stable callback, which keeps the
 * memoized book grid from rebuilding on every render. */
export function removeVisit(bookNo: number, chapterNo: number): Visit[] {
  return read().filter((v) => v.bookNo !== bookNo || v.chapterNo !== chapterNo)
}

export function recordVisit(bookNo: number, chapterNo: number, at: number): Visit[] | null {
  if (skipNext) {
    skipNext = false
    return null
  }
  const list = read()
  const head = list[0]
  if (head && head.bookNo === bookNo && head.chapterNo === chapterNo) return null
  const rest = list.filter((v) => v.bookNo !== bookNo || v.chapterNo !== chapterNo)
  return [{ bookNo, chapterNo, at }, ...rest].slice(0, MAX_VISITS)
}
