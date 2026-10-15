import { useLocalStorage } from '@/lib/useLocalStorage'

/** Favourited search strings — kept separately for 關鍵字 and 經節 since
 * they're different syntaxes and shown in different tabs. */
export type SavedQueryKind = 'kw' | 'ref'

function keyFor(kind: SavedQueryKind): string {
  return `rcv/saved-queries-${kind}`
}

export function useSavedQueries(kind: SavedQueryKind) {
  const [saved, setSaved] = useLocalStorage<string[]>(keyFor(kind), [])

  const isSaved = (q: string): boolean => saved.includes(q.trim())

  const toggle = (q: string) => {
    const t = q.trim()
    if (!t) return
    setSaved(isSaved(t) ? saved.filter((s) => s !== t) : [...saved, t])
  }

  return { saved, isSaved, toggle }
}
