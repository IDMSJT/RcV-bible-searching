/** Inline semantic span over `text` (offsets are char indices). */
export interface Mark {
  /** pn=人名, png=地名, add=補字, tl=音譯 */
  k: 'pn' | 'png' | 'add' | 'tl'
  s: number
  e: number
}

export interface Verse {
  verse: number
  text: string
  segments?: string[]
  marks?: Mark[]
}

export interface Chapter {
  chapterNo: number
  verses: Verse[]
}

export interface Book {
  bookNo: number
  name: string
  chapters: Chapter[]
}

export interface Bible {
  name: string
  lang: string
  source: string
  books: Book[]
}

export interface OutlineAnchor {
  chapter: number
  verse?: number
  segment?: number
}

export interface OutlineEntry {
  level: number
  marker: string
  title: string
  range?: string
  /** A 續 continuation heading repeated at a chapter top. */
  continued?: boolean
  anchor: OutlineAnchor
}

/** One line of a book's introduction — 著者 as its heading, the writer's name as
 * its body, the two separated in the source by an ideographic space.
 *
 * An ordered list rather than named fields, because neither the headings nor how
 * many there are is fixed: nine kinds appear across the canon — 著者 on every
 * book, 受者 only on the letters, 盡職時間 / 盡職地點 / 盡職對象 on the prophets,
 * 記載地點 on three — and a book carries three or four of them. Nothing reads
 * them by name; they are printed in the order the book prints them. */
export interface IntroSection {
  /** 著者 / 著時 / 著地 / 受者 / … — empty if the source gave none. */
  label: string
  text: string
}

export interface BookOutline {
  bookNo: number
  name: string
  outline: OutlineEntry[]
  /** 神創造，撒但敗壞，人墮落… — the book in one line. */
  topic?: string
  intro?: IntroSection[]
}

export interface Outline {
  name: string
  lang: string
  books: BookOutline[]
}

/** Key into the per-verse overlays: `${bookNo}.${chapterNo}.${verse}`.
 *
 * The overlays (notes, cross-refs) are flat maps rather than the nested
 * book→chapter→verse arrays `verse.json` uses: the Bible text is walked a
 * chapter at a time, but an overlay is looked up per verse, so a keyed map
 * beats three levels of `.find()`. */
export type VerseKey = string

export function verseKey(bookNo: number, chapterNo: number, verse: number): VerseKey {
  return `${bookNo}.${chapterNo}.${verse}`
}

/** A footnote on a verse. One note can be anchored at several places in the
 * same verse, so `offsets` holds every char index the superscript sits at
 * (ascending; usually just one). */
export interface Annotation {
  n: number
  offsets: number[]
  text: string
}

export interface AnnotationData {
  source: string
  notes: Record<VerseKey, Annotation[]>
}

/** A cross-reference (串珠): a marker in the verse text pointing at related
 * verses. `refs` is the raw citation string (約壹一1，參西一17，創一1) — it is
 * parsed into links at render time rather than baked into the data. */
export interface CrossRef {
  /** Marker letter shown inline (a, b, c… restarting each verse). */
  m: string
  /** Every char index the marker sits at — one cross-ref can be anchored at
   * several places in the same verse, exactly like a footnote. */
  offsets: number[]
  refs: string
}

export interface CrossRefData {
  source: string
  refs: Record<VerseKey, CrossRef[]>
}
