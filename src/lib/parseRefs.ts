import { toChineseNumber } from './chinese'
import { BOOK_ALIASES, BOOK_ALIAS_RE } from '@/data/bookAliases'

const CN_TO_NUM = new Map<string, number>()
for (let i = 0; i <= 199; i++) CN_TO_NUM.set(toChineseNumber(i), i)

const CN = '[零一二三四五六七八九十百]+'
const NUM = `(?:\\d+|${CN})`
const RANGE = '[-－~～至到]'

// Chapter+verse with 章/篇 (CN or arabic numbers): 一章一節 / 詩二三篇一節 / 1章1節
const RE_CHAPTER_VERSE = new RegExp(`^(${NUM})[章篇](${NUM})(?:${RANGE}(${NUM}))?節?$`)
// Colon style: 1:1 / 1:1-3 / 一:一
const RE_COLON = new RegExp(`^(${NUM})[:：](${NUM})(?:${RANGE}(${NUM}))?$`)
// Compact: CN chapter directly followed by an arabic verse — 約一1, 約一1-3
const RE_COMPACT = new RegExp(`^(${CN})(\\d+)(?:${RANGE}(\\d+))?$`)
// Verse only (inherits chapter): 二十節 / 20 / 16至21節 / 1-3
const RE_VERSE_ONLY = new RegExp(`^(${NUM})(?:${RANGE}(${NUM}))?節?$`)

const SPLIT_RE = /[，、,；;\s\n]+/
const SPLIT_CAPTURE_RE = /([，、,；;\s\n]+)/
const CN_DIGITS = '零一二三四五六七八九'

export interface VerseRef {
  bookNo: number
  chapterNo: number
  verseStart: number
  verseEnd: number
  source: string
}

export interface ParseError {
  token: string
  reason: string
}

export interface ParseResult {
  refs: VerseRef[]
  errors: ParseError[]
  /** ok/fail status for each non-empty token, in order. */
  statuses: boolean[]
}

export interface Segment {
  text: string
  /** true for a token (parseable unit), false for a separator. */
  token: boolean
}

function parseNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  const std = CN_TO_NUM.get(s)
  if (std != null) return std
  // Positional CN digits (no 十/百): 二三 → 23, 一一九 → 119
  if ([...s].every((c) => CN_DIGITS.includes(c))) {
    const digits = [...s].map((c) => CN_DIGITS.indexOf(c)).join('')
    return Number(digits)
  }
  return null
}

const SEP_ONLY_RE = /^[，、,；;\s\n]+$/

/** Split input into tokens and separators (for highlighting), preserving order. */
export function segmentInput(input: string): Segment[] {
  return input
    .split(SPLIT_CAPTURE_RE)
    .filter((s) => s !== '')
    .map((s) => ({ text: s, token: !SEP_ONLY_RE.test(s) }))
}

export function parseRefs(input: string): ParseResult {
  const tokens = input.split(SPLIT_RE).filter(Boolean)
  const refs: VerseRef[] = []
  const errors: ParseError[] = []
  const statuses: boolean[] = []

  let curBook: number | null = null
  let curChapter: number | null = null

  for (const token of tokens) {
    const out = parseToken(token, curBook, curChapter)
    if (!out.ok) {
      errors.push({ token, reason: out.reason })
      statuses.push(false)
      continue
    }
    curBook = out.ref.bookNo
    curChapter = out.ref.chapterNo
    refs.push(out.ref)
    statuses.push(true)
  }

  return { refs, errors, statuses }
}

type Parsed =
  | { ok: true; ref: VerseRef }
  | { ok: false; reason: string }

function parseToken(token: string, curBook: number | null, curChapter: number | null): Parsed {
  let rest = token
  let book = curBook
  let chapter = curChapter

  // Book (optional — inherits when absent).
  const bMatch = rest.match(BOOK_ALIAS_RE)
  if (bMatch) {
    book = BOOK_ALIASES.get(bMatch[1])!
    rest = rest.slice(bMatch[1].length)
  }

  let vStartStr: string | undefined
  let vEndStr: string | undefined

  let m: RegExpMatchArray | null
  if ((m = rest.match(RE_CHAPTER_VERSE))) {
    chapter = parseNum(m[1])
    vStartStr = m[2]
    vEndStr = m[3]
  } else if ((m = rest.match(RE_COLON))) {
    chapter = parseNum(m[1])
    vStartStr = m[2]
    vEndStr = m[3]
  } else if ((m = rest.match(RE_COMPACT))) {
    chapter = parseNum(m[1])
    vStartStr = m[2]
    vEndStr = m[3]
  } else if ((m = rest.match(RE_VERSE_ONLY))) {
    vStartStr = m[1]
    vEndStr = m[2]
  } else {
    return { ok: false, reason: rest === '' ? '缺少章節' : `無法解析: ${rest}` }
  }

  const start = parseNum(vStartStr)
  if (start == null) return { ok: false, reason: `節數無法解析: ${vStartStr}` }
  const end = vEndStr ? parseNum(vEndStr) : start
  if (end == null) return { ok: false, reason: `節數無法解析: ${vEndStr}` }
  if (chapter == null) return { ok: false, reason: chapter == null && book == null ? '缺少書名與章' : '缺少章' }
  if (book == null) return { ok: false, reason: '缺少書名' }

  return {
    ok: true,
    ref: { bookNo: book, chapterNo: chapter, verseStart: start, verseEnd: end, source: token },
  }
}
