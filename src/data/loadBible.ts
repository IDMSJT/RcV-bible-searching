import { useEffect, useState } from 'react'
import type { Bible, Chapter, Outline, OutlineEntry } from '../types/bible'

function makeJsonLoader<T>(file: string) {
  let cached: T | null = null
  let pending: Promise<T> | null = null

  return function useJson(): { data: T | null; error: string | null } {
    const [data, setData] = useState<T | null>(cached)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      if (cached) return
      if (!pending) {
        pending = fetch(`${import.meta.env.BASE_URL}${file}`).then((r) => {
          if (!r.ok) throw new Error(`${file} ${r.status}`)
          return r.json() as Promise<T>
        })
      }
      pending
        .then((d) => {
          cached = d
          setData(d)
        })
        .catch((e) => setError(String(e)))
    }, [])

    return { data, error }
  }
}

export const useBible = makeJsonLoader<Bible>('verse.json')
export const useOutline = makeJsonLoader<Outline>('outline.json')

export function findChapter(
  bible: Bible | null,
  bookNo: number,
  chapterNo: number,
): Chapter | null {
  if (!bible) return null
  const book = bible.books.find((b) => b.bookNo === bookNo)
  if (!book) return null
  return book.chapters.find((c) => c.chapterNo === chapterNo) ?? null
}

/** Outline entries for a given book + chapter, keyed by `${verse}:${segment}`. */
export function chapterOutlineByAnchor(
  outline: Outline | null,
  bookNo: number,
  chapterNo: number,
): Map<string, OutlineEntry[]> {
  const map = new Map<string, OutlineEntry[]>()
  if (!outline) return map
  const book = outline.books.find((b) => b.bookNo === bookNo)
  if (!book) return map
  for (const e of book.outline) {
    if (e.anchor.chapter !== chapterNo || e.anchor.verse == null) continue
    const key = `${e.anchor.verse}:${e.anchor.segment ?? 0}`
    const list = map.get(key)
    if (list) list.push(e)
    else map.set(key, [e])
  }
  return map
}
