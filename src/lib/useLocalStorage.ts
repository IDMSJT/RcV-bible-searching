import { useCallback, useEffect, useState } from 'react'

// Same-tab subscribers per key, so all hook instances stay in sync when one
// updates (localStorage 'storage' events don't fire in the originating tab).
const subscribers = new Map<string, Set<(v: unknown) => void>>()

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    let set = subscribers.get(key)
    if (!set) {
      set = new Set()
      subscribers.set(key, set)
    }
    const fn = setValue as (v: unknown) => void
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }, [key])

  const update = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        // ignore quota / serialization errors
      }
      subscribers.get(key)?.forEach((fn) => fn(v))
    },
    [key],
  )

  return [value, update]
}
