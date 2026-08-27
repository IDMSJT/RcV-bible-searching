import { useEffect, useMemo, useRef, useState } from 'react'

/** Vertical room each slot (a dot, or the testament divider) gets on the rail. */
const RAIL_SLOT = 10

/** Where a book's first row lands below the top of the results — the rail's own
 * gap, smaller than the reading REVEAL_GAP, since a jumped-to list wants less
 * air above it than a jumped-to verse. */
const LAND_GAP = 8

/** Space the docked copy bar takes at the foot of the results, kept clear so the
 * dots centre in the visible results, not behind it. */
const BAR_RESERVE = '3rem'

export type RailBook = { no: number; label: string }

/**
 * The book rail down the right edge of the search results — 書軌 — the same
 * contact-list index the 經節軌 is, one dimension up: dragging runs the results
 * list to a book's first row and leaves it there.
 *
 * No book names on the rail — one plain dot per book, evenly spaced, with a
 * short rule taking its own slot where the canon crosses from the Old Testament
 * to the New. The 書名泡泡 snaps to the dot under the finger and names its book
 * (an abbreviation, 林前). When a search spans more books than fit, the spacing
 * compresses rather than thinning the dots.
 *
 * Positioned `absolute` against the results box (its parent is `relative`), not
 * `fixed`, so it rides along with the tab carousel's transform. */
export function BookRail({
  books,
  scrollRef,
}: {
  books: RailBook[]
  /** The results' own scroll container — the rail reads its rows' positions and
   * scrolls it, so it has to be the element the results actually scroll in. */
  scrollRef: React.RefObject<HTMLElement | null>
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const [held, setHeld] = useState<RailBook | null>(null)
  const [heldY, setHeldY] = useState(0)
  const [budget, setBudget] = useState(() => window.innerHeight * 0.62)

  useEffect(() => {
    const onResize = () => setBudget(window.innerHeight * 0.62)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const n = books.length
  // Index of the first New Testament book (≤39 OT, ≥40 NT); its own slot goes
  // between it and the last OT book. null when the results are one testament.
  const firstNt = useMemo(() => {
    const i = books.findIndex((b) => b.no >= 40)
    return i > 0 && i < n ? i : null
  }, [books, n])

  const slots = n + (firstNt != null ? 1 : 0)
  const railHeight = Math.min(slots * RAIL_SLOT, budget)
  // Which slot a book / the divider sits in — books after the divider are pushed
  // down one — and the top of a slot within the rail.
  const slotOfBook = (i: number) => (firstNt != null && i >= firstNt ? i + 1 : i)
  const topOf = (slot: number) => (slots > 1 ? (slot / (slots - 1)) * railHeight : 0)

  const pick = (clientY: number) => {
    const rail = railRef.current
    const scroller = scrollRef.current
    if (!rail || !scroller) return
    const { top, height } = rail.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientY - top) / height))
    const slot = Math.round(frac * (slots - 1))
    // Map the slot back to a book, stepping over the divider's slot.
    let idx = firstNt != null && slot > firstNt ? slot - 1 : slot
    idx = Math.min(n - 1, Math.max(0, idx))
    const book = books[idx]
    if (!book) return
    setHeld(book)
    // Bubble sits at the centre of the rail's space, not with the finger.
    const railTop = top - (wrapRef.current?.getBoundingClientRect().top ?? 0)
    setHeldY(railTop + height / 2)
    // First row of that book — results are in canonical order, so it's the start
    // of the book's run.
    const row = scroller.querySelector<HTMLElement>(`[data-book="${book.no}"]`)
    if (!row) return
    const by = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - LAND_GAP
    scroller.scrollTo({ top: scroller.scrollTop + by, behavior: 'instant' })
  }

  const release = () => setHeld(null)

  return (
    // Fill the results box, minus the copy bar's foot, and centre the rail in
    // what's left. pointer-events-none so only the dot column takes the drag.
    <>
      {/* 書名泡泡 — centred in the results space, names the book (an abbrev). Same
       * pill as the verse rail's 數字泡泡 (no tabular-nums — abbrevs aren't
       * digits). Outside the rail's right-edge wrapper so it can centre across
       * the whole results width. */}
      {held && (
        <div
          className="pointer-events-none absolute left-1/2 z-20 flex min-w-10 -translate-x-1/2 -translate-y-1/2 justify-center rounded-lg bg-foreground px-2 py-1.5 font-sans text-lg font-medium whitespace-nowrap text-background shadow-lg"
          style={{ top: heldY }}
        >
          {held.label}
        </div>
      )}
      <div
        ref={wrapRef}
        className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center"
        style={{ paddingBottom: BAR_RESERVE }}
      >
      <div
        ref={railRef}
        // Capture keeps the drag on the rail once it starts, so the tab
        // carousel's horizontal swipe can't steal it mid-scrub.
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientY)
        }}
        onPointerUp={release}
        onPointerCancel={release}
        style={{ height: railHeight }}
        className="pointer-events-auto relative w-8 touch-none select-none"
      >
        {/* The dots + divider live in a narrow strip pinned to the right — the
          * look is unchanged; the wider hit area is the transparent space to its
          * left, so the thin column is easy to grab. */}
        <div className="absolute inset-y-0 right-0 w-4">
          {books.map((b, i) => (
            <span
              key={b.no}
              className="absolute left-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40"
              style={{ top: topOf(slotOfBook(i)) }}
            />
          ))}
          {firstNt != null && (
            <span
              className="absolute left-1/2 h-px w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/60"
              style={{ top: topOf(firstNt) }}
            />
          )}
        </div>
      </div>
      </div>
    </>
  )
}
