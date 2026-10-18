import { displayMarker } from '@/lib/chinese'
import type { RailItem } from '@/components/VerseRail'
import type { BookOutline } from '@/types/bible'

/** Id of the rail stop for the book's introduction; the headings use their
 * index in the book outline, so this can't collide with one. */
export const INTRO_ID = -1

/** The outline rail's stops: 介 for the book introduction (when the book has
 * one), then each top-level heading by its marker (壹 貳 參…). A book with
 * nothing to choose between gets none — 撒下、王下、詩篇 have no top-level
 * headings at all. */
export function outlineRailItems(book: BookOutline | undefined): RailItem[] {
  if (!book) return []
  const items: RailItem[] = []
  if (book.topic || book.intro?.length) items.push({ id: INTRO_ID, label: '介' })
  book.outline.forEach((e, i) => {
    if (e.level === 1 && e.marker) items.push({ id: i, label: displayMarker(e.marker) })
  })
  return items.length >= 2 ? items : []
}
