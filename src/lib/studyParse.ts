import { CANON } from '@/data/canon'
import { CN_NUMERAL_CLASS } from './chinese'
import { parseToken, type ParseCtx, type VerseRef } from './parseToken'

export type { VerseRef } from './parseToken'

// Full book names (羅馬書, 啟示錄…) — scanned in the prose so a chapterless
// ref that follows ("叁　羅馬書啟示…— 一17") attaches to the named book even
// when an earlier short alias would have inherited a different one.
const NAME_TO_NO = new Map(CANON.map((b) => [b.name, b.bookNo]))
const BOOK_NAME_RE = new RegExp(
  '(' +
    CANON.map((b) => b.name)
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')',
  'g',
)

const MARKER_RE = new RegExp(
  `^([壹貳參肆伍陸柒捌玖拾]+|${CN_NUMERAL_CLASS}|\\d+|[A-Za-z])[　 ]+(.*)$`,
)
const WEEK_RE = /^【\s*週/

function levelFromMarker(mk: string): number {
  if (/^[壹貳參肆伍陸柒捌玖拾]+$/.test(mk)) return 1
  if (/^[一二三四五六七八九十百]+$/.test(mk)) return 2
  if (/^\d+$/.test(mk)) return 3
  if (/^[A-Za-z]$/.test(mk)) return 4
  return 5
}

export interface StudySegment {
  text: string
  /** Present when this segment is a reference token (empty array = unparseable). */
  refs?: VerseRef[]
}

/** Parse one comma-separated reference list (e.g. "創二9，約十10下，十四6上"). */
function parseRefList(s: string, ctx: ParseCtx): VerseRef[] {
  const refs: VerseRef[] = []
  for (const token of s.split(/[，,]/)) {
    const out = parseToken(token, ctx)
    refs.push(...out.refs)
  }
  return refs
}

function scanBook(text: string, ctx: ParseCtx): void {
  let found: string | null = null
  for (const m of text.matchAll(BOOK_NAME_RE)) found = m[1]
  if (found) ctx.book = NAME_TO_NO.get(found) ?? ctx.book
}

// A reference region: refs after a dash, OR refs inside a (…) group.
const DASH_CLASS = '—─－\\-―'
const REGION_RE = new RegExp(`([${DASH_CLASS}])([^（）()：:。」\\n]+)|（([^（）]*)）`, 'g')
const LAST_DASH_RE = new RegExp(`[${DASH_CLASS}](?=[^${DASH_CLASS}]*$)`)

function emitRefs(refsPart: string, ctx: ParseCtx, segs: StudySegment[]): void {
  for (const tok of refsPart.split(/([，,])/)) {
    if (!tok) continue
    if (tok === '，' || tok === ',') segs.push({ text: tok })
    else segs.push({ text: tok, refs: parseRefList(tok, ctx) })
  }
}

function segmentLine(line: string, ctx: ParseCtx): StudySegment[] {
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
  const ctx: ParseCtx = { book: null, chapter: null }
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
