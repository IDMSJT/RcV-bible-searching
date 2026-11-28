import { useEffect, useState } from 'react'

/** `value`, but only once it has stopped changing for `ms` — so work keyed on it
 * (a full-text search) runs when typing pauses, not on every keystroke.
 * `immediate(v)`: pass v through at once (clearing a field shouldn't wait).
 * `hold(v)`: don't take v at all, keep the last settled value (text still being
 * composed in an input method). */
export function useDebouncedValue<T>(
  value: T,
  ms: number,
  immediate?: (v: T) => boolean,
  hold?: (v: T) => boolean,
): T {
  const [settled, setSettled] = useState(value)
  const now = immediate?.(value) ?? false
  const held = hold?.(value) ?? false
  useEffect(() => {
    if (now || held) return
    const id = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms, now, held])
  return now ? value : settled
}
