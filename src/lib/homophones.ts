import { makeConverter } from '@/lib/zhConv'

// Searching by sound, for when the characters typed are wrong but read right
// (別士巴 for 別是巴). Every character folds to one representative of its
// toneless Mandarin reading — table from scripts/build_homophones.py, fetched
// the first time a search comes up empty. One character for one, so where a
// match sits in the folded text is where it sits in the real one.

export type Fold = (text: string) => string

let pending: Promise<Fold> | null = null

export function loadFold(): Promise<Fold> {
  pending ??= import('@/data/homophones.json').then((m) => makeConverter({ c: m.default.c, p: '' }))
  return pending
}

/** The stretches of `text` that sound like `word`, as `text` writes them. */
export function soundMatches(text: string, word: string, fold: Fold): string[] {
  const hay = fold(text)
  const needle = fold(word)
  const out: string[] = []
  if (!needle) return out
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    out.push(text.slice(i, i + needle.length))
  }
  return out
}
