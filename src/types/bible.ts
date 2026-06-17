export interface Note {
  n: number
  pos: number
}

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
  notes?: Note[]
  /** Text length changed vs the annotated edition — note positions need rechecking. */
  noteShift?: boolean
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

export interface BookOutline {
  bookNo: number
  name: string
  outline: OutlineEntry[]
}

export interface Outline {
  name: string
  lang: string
  books: BookOutline[]
}
