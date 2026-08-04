/** Where a scrolling region's position is written down. Shared so the one
 * caller that has to record a position by hand names it the same way
 * ScrollBody does. */
export const scrollKey = (id: string) => `rcv/scroll${id}`

/**
 * Write a region's position down now, ahead of a navigation that would restore
 * over it. Clearing `?hl=` unpauses the body, and the restore that follows
 * would land on the reading position from before the jump rather than on the
 * verse the reader is looking at.
 */
export function rememberScroll(el: HTMLElement | null, id: string): void {
  if (el) sessionStorage.setItem(scrollKey(id), String(el.scrollTop))
}
