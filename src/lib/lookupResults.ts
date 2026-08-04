import { eachVerseInRange, findChapter, notesForVerse } from '@/data/loadBible'
import { hasVariant, tokenPattern } from '@/lib/variants'
import type { VerseRef } from '@/lib/parseRefs'
import type { Annotation, AnnotationData, Bible, Verse } from '@/types/bible'

/**
 * Turning a query into rows: the part of the lookup that is only data.
 *
 * It lived inside the panel, where the only way to check it was to type into
 * the app and look. Both kinds of search have real branching — a reference can
 * name a range, cross a chapter, or point at a footnote instead of a verse; a
 * keyword has to match Chinese variants and English in one pass, and report an
 * honest total while listing only the first few hundred — and none of it was
 * under test.
 */

/** One row of the results list. */
export interface ResolvedVerse {
  /** Which entry of the flat ref list produced this row — several rows come
   * from one ref when it names a range, and the input's citations are grouped
   * by that index. Absent for a keyword result, which comes from matching text
   * rather than from a citation. */
  refIndex?: number
  bookNo: number
  chapterNo: number
  verse: Verse
  /** English translation, when 顯示英文 is on and the English bible has the
   * matching verse. Stored as a plain string because the English DB doesn't
   * carry the same marks / segment structure. */
  enText?: string
  /** Single note attached to the ref via 注N / 註N suffix.
   *
   * - With a connector (與註1, ，註1) the verse is the row's main content and
   *   the note renders inline below it.
   * - Without a connector (啟二一23註1) the row is "note-only": the verse
   *   itself isn't shown and the note takes its place. */
  noteToShow?: Annotation
  noteOnly?: boolean
  /** The ref this row answers, narrowed to this one verse. Navigation and the
   * input's own highlighting both key off it. */
  ref: VerseRef
}

export interface Sources {
  bible: Bible | null
  bibleEn: Bible | null
  annotations: AnnotationData | null
  showEnglish: boolean
}

/** Rows for every verse the references name, in the order they name them. */
export function resolveRefs(refs: VerseRef[], src: Sources): ResolvedVerse[] {
  const { bible, bibleEn, annotations, showEnglish } = src
  if (!bible) return []
  const english = (bookNo: number, chapterNo: number, verse: number) =>
    showEnglish
      ? findChapter(bibleEn, bookNo, chapterNo)?.verses.find((x) => x.verse === verse)?.text
      : undefined

  const out: ResolvedVerse[] = []
  for (const [refIndex, ref] of refs.entries()) {
    // A note only attaches to a single verse in one chapter — a range or a
    // cross-chapter span can't say which verse the 「注N」 belongs to.
    const wantsNote =
      ref.note != null && ref.verseStart === ref.verseEnd && ref.chapter === ref.endChapter

    // Walk every verse the ref covers — spans chapters for a cross-chapter
    // range. English / annotation lookups key off each verse's REAL chapter
    // (vCh), not the ref's start chapter.
    for (const { chapterNo: vCh, verse: v } of eachVerseInRange(
      bible,
      ref.bookNo,
      ref.chapter,
      ref.endChapter,
      ref.verseStart,
      ref.verseEnd,
    )) {
      const thisVerse = { chapter: vCh, endChapter: vCh, verseStart: v.verse, verseEnd: v.verse }

      // Bare 註 (noteAll): every footnote on this verse becomes its own
      // note-only row. Each row carries a synthesised single-note ref so the
      // existing refHl / navigation / backdrop machinery works unchanged.
      // Connected form (太八2與註) also emits the verse row first.
      if (ref.noteAll) {
        if (!ref.noteDirect) {
          // Keep noteAll (narrowed to this verse) so clicking the verse row
          // opens the verse + all its notes in reading (hl 「v,v:*」), like the
          // 與註1 connected form does for a single note.
          out.push({
            refIndex,
            bookNo: ref.bookNo,
            chapterNo: vCh,
            verse: v,
            enText: english(ref.bookNo, vCh, v.verse),
            ref: { ...ref, ...thisVerse },
          })
        }
        for (const note of notesForVerse(annotations, ref.bookNo, vCh, v.verse)) {
          out.push({
            refIndex,
            bookNo: ref.bookNo,
            chapterNo: vCh,
            verse: v,
            noteToShow: note,
            noteOnly: true,
            // 與註 (non-direct): every listed row — verse and each note —
            // targets the whole verse + all its notes (7,7:*), so clicking any
            // of them lights the same set in reading. Direct 註 keeps the note
            // alone as the target.
            ref: ref.noteDirect
              ? { ...ref, noteAll: undefined, note: note.n, noteDirect: true }
              : { ...ref, ...thisVerse },
          })
        }
        continue
      }

      const isAttachedVerse = wantsNote && vCh === ref.chapter && v.verse === ref.verseStart
      const noteToShow = isAttachedVerse
        ? notesForVerse(annotations, ref.bookNo, ref.chapter, v.verse).find((n) => n.n === ref.note)
        : undefined

      // Direct 注N (啟二一23註1) → ONE note-only row in place of the verse.
      // Drop it entirely when the note doesn't exist (typo / out-of-range N).
      if (isAttachedVerse && ref.noteDirect) {
        if (!noteToShow) continue
        out.push({
          refIndex,
          bookNo: ref.bookNo,
          chapterNo: vCh,
          verse: v,
          noteToShow,
          noteOnly: true,
          ref,
        })
        continue
      }

      out.push({
        refIndex,
        bookNo: ref.bookNo,
        chapterNo: vCh,
        verse: v,
        enText: english(ref.bookNo, vCh, v.verse),
        ref,
      })

      // Connected 注N (啟二一23與註1) → ALSO add a separate note-only row right
      // after the verse, so the user sees both targets as distinct results.
      if (isAttachedVerse && !ref.noteDirect && noteToShow) {
        out.push({
          refIndex,
          bookNo: ref.bookNo,
          chapterNo: vCh,
          verse: v,
          noteToShow,
          noteOnly: true,
          ref,
        })
      }
    }
  }
  return out
}

/** Whether each reference names at least one verse that exists.
 *
 * Resolved iff at least one real verse falls in the (possibly cross-chapter)
 * span — mirroring the row expansion, so a valid 十一27～十二37 isn't marked
 * wrong merely because its end verse exceeds the start chapter. */
export function refsExist(refs: VerseRef[], bible: Bible | null): boolean[] {
  if (!bible) return refs.map(() => true)
  return refs.map((ref) => {
    for (const _ of eachVerseInRange(
      bible,
      ref.bookNo,
      ref.chapter,
      ref.endChapter,
      ref.verseStart,
      ref.verseEnd,
    )) {
      void _
      return true
    }
    return false
  })
}

/**
 * Verses matching every word of a keyword query.
 *
 * Each word must appear in the Chinese or the English, which gives a forgiving
 * mixed-language search with no language to choose. Every match is counted so
 * the total is honest, but only `cap` rows are built — a one-character query
 * would otherwise put every verse in the canon into an unvirtualised list.
 */
export function searchKeyword(
  query: string,
  src: Sources,
  cap: number,
): { rows: ResolvedVerse[]; total: number } {
  const { bible, bibleEn, showEnglish } = src
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!bible || words.length === 0) return { rows: [], total: 0 }

  // A variant-expanded regex (吃 also matches 喫) when the word carries a
  // variant character, otherwise the plain fast `includes`. Built once per
  // query and reused across every verse.
  const matchers = words.map((t) => {
    if (hasVariant(t)) {
      const re = new RegExp(tokenPattern(t))
      return { t, zh: (h: string) => re.test(h) }
    }
    return { t, zh: (h: string) => h.includes(t) }
  })

  const rows: ResolvedVerse[] = []
  let total = 0
  for (const book of bible.books) {
    for (const chapter of book.chapters) {
      const en = showEnglish ? findChapter(bibleEn, book.bookNo, chapter.chapterNo) : null
      for (const v of chapter.verses) {
        const enText = en?.verses.find((x) => x.verse === v.verse)?.text ?? ''
        const enLower = enText.toLowerCase()
        if (!matchers.every((m) => m.zh(v.text) || enLower.includes(m.t))) continue
        total++
        if (rows.length >= cap) continue
        rows.push({
          bookNo: book.bookNo,
          chapterNo: chapter.chapterNo,
          verse: v,
          enText: enText || undefined,
          ref: {
            bookNo: book.bookNo,
            chapter: chapter.chapterNo,
            endChapter: chapter.chapterNo,
            verseStart: v.verse,
            verseEnd: v.verse,
            seg: null,
            source: '',
          },
        })
      }
    }
  }
  return { rows, total }
}
