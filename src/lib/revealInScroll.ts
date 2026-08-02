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
 * Bring `el` into view, and only if it isn't already there.
 *
 * Something that opened in plain sight must not make the page jump, so a
 * fully-visible element is left alone. One taller than the view is aligned to
 * the top rather than the bottom, since that is where reading it starts.
 *
 * The container is found by walking up rather than passed in: this is called
 * from a footnote in a chapter, a citation in a book introduction and a verse
 * preview inside either, and each sits in a different one.
 *
 * A phone's bottom bar covers the foot of that container, and the padding the
 * container already reserves for it is exactly how much — zero where there is
 * no bar, so no breakpoint of its own to keep in step.
 */
export function revealInScroll(el: HTMLElement): void {
  const pane = scrollParent(el)
  if (!pane) return
  const box = pane.getBoundingClientRect()
  const covered = parseFloat(getComputedStyle(pane).paddingBottom) || 0
  const floor = box.bottom - covered
  const rect = el.getBoundingClientRect()
  if (rect.top >= box.top && rect.bottom <= floor) return
  const by =
    rect.bottom > floor
      ? Math.min(rect.bottom - floor + GAP, rect.top - box.top - GAP)
      : rect.top - box.top - GAP
  pane.scrollTo({ top: pane.scrollTop + by, behavior: 'smooth' })
}
