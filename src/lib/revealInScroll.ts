/** How much air to leave between the element and the edge it was brought past. */
const GAP = 12

/** The nearest ancestor that actually scrolls, or null if nothing does. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollHeight > p.clientHeight) {
      return p
    }
  }
  return null
}

/**
 * Bring one or more elements into view, and only if they aren't already there.
 *
 * Several are treated as the block they make up: enough is scrolled to reach the
 * last of them, but never so much that the first passes above the top. Reading
 * starts at the first, so losing it to gain the end of the last would be the
 * wrong trade.
 *
 * `keep` says which end matters when the block is taller than the view. The
 * default keeps the first, which is where reading starts. Keeping the last
 * suits arriving at a footnote: the note is what was asked for, and the verse
 * above it comes along only if there is room.
 *
 * Something that opened in plain sight must not make the page jump, so a block
 * already visible is left alone. One taller than the view is aligned to the top
 * rather than the bottom, since that is where reading it starts.
 *
 * The container is found by walking up rather than passed in: this is called
 * from a footnote in a chapter, a citation in a book introduction and a verse
 * preview inside either, and each sits in a different one.
 *
 * A phone's bottom bar covers the foot of that container, and the padding the
 * container already reserves for it is exactly how much — zero where there is
 * no bar, so no breakpoint of its own to keep in step.
 */
export function revealInScroll(
  target: HTMLElement | HTMLElement[],
  keep: 'first' | 'last' = 'first',
): void {
  let els = Array.isArray(target) ? target : [target]
  if (els.length === 0) return
  const pane = scrollParent(els[0])
  if (!pane) return
  const box = pane.getBoundingClientRect()
  const covered = parseFloat(getComputedStyle(pane).paddingBottom) || 0
  const floor = box.bottom - covered
  const span = (list: HTMLElement[]) => {
    const rects = list.map((el) => el.getBoundingClientRect())
    return {
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }
  }
  // Keeping the last: drop what leads it, one at a time, until the rest fits.
  if (keep === 'last') {
    while (els.length > 1) {
      const { top: t, bottom: b } = span(els)
      if (b - t <= floor - box.top - GAP * 2) break
      els = els.slice(1)
    }
  }
  const { top, bottom } = span(els)
  if (top >= box.top && bottom <= floor) return
  // Reaching the bottom, unless that would carry the top past the ceiling.
  const by =
    bottom > floor
      ? Math.min(bottom - floor + GAP, top - box.top - GAP)
      : top - box.top - GAP
  pane.scrollTo({ top: pane.scrollTop + by, behavior: 'smooth' })
}
