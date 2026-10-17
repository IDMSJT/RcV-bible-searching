/** A transient "focus the active search field" signal — tapping the 搜尋 nav
 * icon while already on /search has nothing to navigate to, but is still a
 * deliberate request to go type. __root.tsx (outside LookupPanel's route)
 * can't reach its textarea refs directly, so this is a plain same-tab pub/sub
 * instead, same idea as useLocalStorage's subscriber set. Not persisted —
 * there's no "last value" to replay, only a thing that just happened. */
const listeners = new Set<() => void>()

export function requestFocusSearch(): void {
  listeners.forEach((fn) => fn())
}

/** Subscribe to focus requests; call the returned function to unsubscribe. */
export function onFocusSearchRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
