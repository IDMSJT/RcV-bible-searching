import { useEffect, useState } from 'react'

/** `value`, but only once it has stopped changing for `ms` — so work keyed on it
 * (a full-text search) runs when typing pauses, not on every keystroke. An empty
 * value goes through at once: clearing the field shouldn't wait. */
export function useDebouncedValue<T>(value: T, ms: number, immediate?: (v: T) => boolean): T {
  const [settled, setSettled] = useState(value)
  const now = immediate?.(value) ?? false
  useEffect(() => {
    if (now) return
    const id = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms, now])
  return now ? value : settled
}
