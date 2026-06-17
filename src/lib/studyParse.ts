import { BOOK_ALIASES, BOOK_ALIAS_RE } from '@/data/bookAliases'
import { CANON } from '@/data/canon'
import { toChineseNumber } from './chinese'

// Full book names (羅馬書, 啟示錄…). When the prose names a book, later refs
// without an explicit book prefix should belong to it (e.g. 「叁　羅馬書啟示…—
// 一17，八10」 = Romans, not the previously-cited 啟示錄).
const NAME_TO_NO = new Map(CANON.map((b) => [b.name, b.bookNo]))
const BOOK_NAME_RE = new RegExp(
  '(' +
    CANON.map((b) => b.name)
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')',
  'g',
)

// CN numeral → number (standard 一/十/二十… plus positional 二一 = 21).
const CN_TO_NUM = new Map<string, number>()
for (let i = 0; i <= 199; i++) CN_TO_NUM.set(toChineseNumber(i), i)
const CN_DIGITS = '零一二三四五六七八九'

function cnToNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  const v = CN_TO_NUM.get(s)
  if (v != null) return v
  if (s.length > 0 && [...s].every((c) => CN_DIGITS.includes(c))) {
    return Number([...s].map((c) => CN_DIGITS.indexOf(c)).join(''))
  }
  return null
}

export interface VerseRef {
  bookNo: number
  chapter: number
  verseStart: number
  /** End chapter — equals `chapter` unless the range crosses chapters (十一36～十二5). */
  endChapter: number
  verseEnd: number
  /** 0 = 上, 1 = 下, null = whole verse. Only meaningful for a single verse. */
  seg: number | null
  source: string
}

export interface StudySegment {
  text: string
  /** Present when this segment is a reference token (empty array = unparseable). */
  refs?: VerseRef[]
}

type Ctx = { book: number | null; chapter: number | null }

const CN = '[零一二三四五六七八九十百]+'
const MARKER_RE = new RegExp(
  `^([壹貳參肆伍陸柒捌玖拾]+|${CN}|\\d+|[A-Za-z])[　 ]+(.*)$`,
)
const WEEK_RE = /^【\s*週/
// startVerse[上下] [~ endChapter? endVerse[上下]] — the range end may carry its
// own CN chapter (十一36～十二5 = 11:36 to 12:5).
const VERSE_RE = /^(\d+)([上下])?(?:[~～]([零一二三四五六七八九十百]+)?(\d+)([上下])?)?$/

function levelFromMarker(mk: string): number {
  if (/^[壹貳參肆伍陸柒捌玖拾]+$/.test(mk)) return 1
  if (/^[一二三四五六七八九十百]+$/.test(mk)) return 2
  if (/^\d+$/.test(mk)) return 3
  if (/^[A-Za-z]$/.test(mk)) return 4
  return 5
}

/** Parse one comma-separated reference list (e.g. "創二9，約十10下，十四6上"). */
function parseRefList(s: string, ctx: Ctx): VerseRef[] {
  const refs: VerseRef[] = []
  for (let token of s.split(/[，,]/)) {
    token = token.trim().replace(/^參/, '').trim()
    if (!token) continue

    const bm = token.match(BOOK_ALIAS_RE)
    if (bm) {
      ctx.book = BOOK_ALIASES.get(bm[1]) ?? ctx.book
      token = token.slice(bm[1].length)
      // No CN chapter right after the book → single-chapter book (e.g. 猶24).
      if (!new RegExp(`^${CN}`).test(token)) ctx.chapter = 1
    }

    const cm = token.match(new RegExp(`^(${CN})`))
    if (cm) {
      const ch = cnToNum(cm[1])
      if (ch != null) ctx.chapter = ch
      token = token.slice(cm[1].length)
    }

    if (ctx.book == null || ctx.chapter == null) continue
    // Capture the narrowed values locally — mutating ctx.chapter at the bottom
    // of the loop would otherwise widen it back to `number | null` for the next
    // iteration and break TS narrowing (tsc -b catches this; tsc --noEmit doesn't).
    const book = ctx.book
    let chapter = ctx.chapter
    for (let vspec of token.split(/[、]/)) {
      vspec = vspec.trim().replace(/節$/, '')
      if (!vspec) continue
      const m = vspec.match(VERSE_RE)
      if (!m) continue
      const isRange = m[4] != null
      const endChapter: number = m[3] ? (cnToNum(m[3]) ?? chapter) : chapter
      refs.push({
        bookNo: book,
        chapter,
        verseStart: Number(m[1]),
        endChapter,
        verseEnd: isRange ? Number(m[4]) : Number(m[1]),
        seg: isRange ? null : m[2] === '上' ? 0 : m[2] === '下' ? 1 : null,
        source: vspec,
      })
      // A later chapter-less ref continues from this range's end chapter
      // (公義 五11 → 聖別 12 means 5:12, not 3:12).
      chapter = endChapter
    }
    ctx.chapter = chapter
  }
  return refs
}

/**
 * Tokenise a line preserving every character, marking each comma-separated
 * reference token (within a dash group) with its parsed refs. `ctx` flows across
 * lines so a 節-only or chapter-less ref inherits from earlier refs.
 */
function scanBook(text: string, ctx: Ctx): void {
  let found: string | null = null
  for (const m of text.matchAll(BOOK_NAME_RE)) found = m[1]
  if (found) ctx.book = NAME_TO_NO.get(found) ?? ctx.book
}

// A reference region: refs after a dash, OR refs inside a (…) group.
const DASH_CLASS = '—─－\\-―'
const REGION_RE = new RegExp(`([${DASH_CLASS}])([^（）()：:。」\\n]+)|（([^（）]*)）`, 'g')
const LAST_DASH_RE = new RegExp(`[${DASH_CLASS}](?=[^${DASH_CLASS}]*$)`)

function emitRefs(refsPart: string, ctx: Ctx, segs: StudySegment[]): void {
  for (const tok of refsPart.split(/([，,])/)) {
    if (!tok) continue
    if (tok === '，' || tok === ',') segs.push({ text: tok })
    else segs.push({ text: tok, refs: parseRefList(tok, ctx) })
  }
}

function segmentLine(line: string, ctx: Ctx): StudySegment[] {
  const segs: StudySegment[] = []
  let last = 0
  REGION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REGION_RE.exec(line)) !== null) {
    const before = line.slice(last, m.index)
    if (before) {
      scanBook(before, ctx) // prose may name the book the following refs belong to
      segs.push({ text: before })
    }
    if (m[1] != null) {
      // dash group: m[1] = dash, m[2] = refs
      segs.push({ text: m[1] })
      emitRefs(m[2], ctx, segs)
    } else {
      // paren group: m[3] = content inside (…)
      const content = m[3]
      segs.push({ text: '（' })
      const dm = content.match(LAST_DASH_RE)
      if (dm) {
        const di = dm.index! + dm[0].length
        scanBook(content.slice(0, di), ctx)
        segs.push({ text: content.slice(0, di) })
        emitRefs(content.slice(di), ctx, segs)
      } else if (parseRefList(content, { ...ctx }).length > 0) {
        emitRefs(content, ctx, segs) // re-parse on real ctx
      } else {
        scanBook(content, ctx)
        segs.push({ text: content })
      }
      segs.push({ text: '）' })
    }
    last = m.index + m[0].length
  }
  if (last < line.length) {
    const tail = line.slice(last)
    scanBook(tail, ctx)
    segs.push({ text: tail })
  }
  return segs
}

export type StudyLine =
  | { kind: 'empty' }
  | { kind: 'week' }
  | { kind: 'point'; level: number; marker: string; segments: StudySegment[]; refs: VerseRef[] }

/** One entry per input line (empties kept) so an editor can align lines 1:1. */
export function parseStudyLines(input: string): StudyLine[] {
  const ctx: Ctx = { book: null, chapter: null }
  return input.split(/\r?\n/).map((raw): StudyLine => {
    const line = raw.trim()
    if (!line) return { kind: 'empty' }
    if (WEEK_RE.test(line)) return { kind: 'week' }
    const m = line.match(MARKER_RE)
    const marker = m ? m[1] : ''
    const segments = segmentLine(line, ctx)
    return {
      kind: 'point',
      level: marker ? levelFromMarker(marker) : 0,
      marker,
      segments,
      refs: segments.flatMap((s) => s.refs ?? []),
    }
  })
}
