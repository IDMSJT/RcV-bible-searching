import { useEffect, useState } from 'react'
import type {
  AnnotationChapter,
  AnnotationData,
  Bible,
  Chapter,
  Outline,
  OutlineEntry,
  Verse,
} from '../types/bible'

function makeJsonLoader<T>(file: string) {
  let cached: T | null = null
  let pending: Promise<T> | null = null

  return function useJson(enabled: boolean = true): { data: T | null; error: string | null } {
    const [data, setData] = useState<T | null>(cached)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      if (!enabled) return
      if (cached) {
        setData(cached)
        return
      }
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
    }, [enabled])

    return { data, error }
  }
}

export const useBible = makeJsonLoader<Bible>('verse.json')
export const useBibleEn = makeJsonLoader<Bible>('verse_en.json')
export const useOutline = makeJsonLoader<Outline>('outline.json')
export const useAnnotations = makeJsonLoader<AnnotationData>('annotations.json')

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

/** Walk every verse a ref touches, spanning chapters when startCh ≠ endCh.
 * Each yielded item carries its real chapter so callers can label / look up
 * per-chapter data (English, annotations) against the right chapter rather
 * than assuming the ref's start chapter. Skips verse 0 (詩篇 superscriptions)
 * unless it's explicitly the range start. */
export function* eachVerseInRange(
  bible: Bible | null,
  bookNo: number,
  startCh: number,
  endCh: number,
  verseStart: number,
  verseEnd: number,
): Generator<{ chapterNo: number; verse: Verse }> {
  if (!bible) return
  for (let c = startCh; c <= endCh; c++) {
    const ch = findChapter(bible, bookNo, c)
    if (!ch) continue
    const from = c === startCh ? verseStart : 1
    const to = c === endCh ? verseEnd : Infinity
    for (const v of ch.verses) {
      if (v.verse < from || v.verse > to) continue
      if (v.verse === 0 && from > 0) continue
      yield { chapterNo: c, verse: v }
    }
  }
}

/** Annotation chapter for a given book + chapter (null when not loaded yet or
 * the chapter has no notes recorded). */
export function findAnnotationChapter(
  data: AnnotationData | null,
  bookNo: number,
  chapterNo: number,
): AnnotationChapter | null {
  if (!data) return null
  const book = data.books.find((b) => b.bookNo === bookNo)
  if (!book) return null
  return book.chapters.find((c) => c.chapterNo === chapterNo) ?? null
}

/** Outline entries for a given book + chapter, keyed by `${verse}:${segment}`. */
export function chapterOutlineByAnchor(
  outline: Outline | null,
  bookNo: number,
  chapterNo: number,
): Map<string, { entry: OutlineEntry; idx: number }[]> {
  const map = new Map<string, { entry: OutlineEntry; idx: number }[]>()
  if (!outline) return map
  const book = outline.books.find((b) => b.bookNo === bookNo)
  if (!book) return map
  // Carry each entry's index in the book outline so callers can identify one
  // specific heading even when several share the same verse:segment anchor.
  book.outline.forEach((e, idx) => {
    if (e.anchor.chapter !== chapterNo || e.anchor.verse == null) return
    const key = `${e.anchor.verse}:${e.anchor.segment ?? 0}`
    const list = map.get(key)
    if (list) list.push({ entry: e, idx })
    else map.set(key, [{ entry: e, idx }])
  })
  return map
}
