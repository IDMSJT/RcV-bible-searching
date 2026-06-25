import { CANON } from '@/data/canon'
import { CN_NUMERAL_CLASS, CN_NUMERAL_CHARS } from './chinese'
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

// `叁` is the formal/anti-fraud variant of `參`; some outlines mix the two.
// Marker is followed by whitespace, ideographic space, OR a punctuation
// separator (、.．) so "壹、" / "1." also parse.
const MARKER_HEAD_CHARS = '壹貳參叁肆伍陸柒捌玖拾'
const MARKER_RE = new RegExp(
  `^([${MARKER_HEAD_CHARS}]+|${CN_NUMERAL_CLASS}|\\d+|[A-Za-z])[　 、.．]+(.*)$`,
)
// 【週一】 (bracketed) is the legacy form; 「週　一」 (the char then a full /
// half-width space then the day character) is the newer copy-paste format.
// Both should render as the same centered small heading.
const WEEK_RE = /^(?:【\s*週|週[　\s]+[一二三四五六七日])/

// Normalise outline copy-paste: collapse the 啓/啟 character variants and
// fullwidth parens that some sources use, so book-name matching and region
// detection don't depend on which form the source happened to ship.
function normalizeOutlineText(input: string): string {
  return input
    .replace(/啓/g, '啟')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

function levelFromMarker(mk: string): number {
  if (new RegExp(`^[${MARKER_HEAD_CHARS}]+$`).test(mk)) return 1
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
// `normalizeOutlineText` collapses 全形（）→ 半形(); the regex needs to match
// the half-width form because that's what the scanner actually sees.
const DASH_CLASS = '—─－\\-―'
const REGION_RE = new RegExp(`([${DASH_CLASS}])([^()：:。」\\n]+)|\\(([^()]*)\\)`, 'g')
const LAST_DASH_RE = new RegExp(`[${DASH_CLASS}](?=[^${DASH_CLASS}]*$)`)
// A dash inside a heading is appositive punctuation (not a range mark) when a
// prose word — a CJK char that isn't a numeral — sits before it:
// 「永遠的生命──三一神──裏作王──羅五18下」. Range dashes are flanked by digits/CN
// numerals only. Spotting prose lets emitRefs peel it so the trailing ref parses.
const PROSE_HAN_RE = new RegExp(`(?![${CN_NUMERAL_CHARS}])[\\u3400-\\u9fff]`)

// `與` joins refs the same way `，` does — context still flows ("詩四八2與五10"
// → 詩48:2 + 詩5:10) but parser sees them as separate tokens. No canonical
// book name contains 與, so listing it among the splitters is safe.
//
// Exception: 「與注N」 / 「與註N」 is NOT a separator — it's the trailing
// footnote suffix attaching to the preceding ref (「詩四八2與註1」). The
// lookahead leaves that 與 inside the ref token so parseToken can swallow
// the suffix and set `.note` on the last verse.
const REF_SEPARATOR_RE = /([，,]|與(?![注註]))/

function emitRefs(refsPart: string, ctx: ParseCtx, segs: StudySegment[]): void {
  for (const tok of refsPart.split(REF_SEPARATOR_RE)) {
    if (!tok) continue
    if (tok === '，' || tok === ',' || tok === '與') {
      segs.push({ text: tok })
      continue
    }
    const refs = parseRefList(tok, ctx)
    if (refs.length > 0) {
      segs.push({ text: tok, refs })
      continue
    }
    // The dash region regex starts at the FIRST dash, so a heading with
    // appositive dashes ("…永遠的生命──三一神──裏作王──羅五18下") hands the whole
    // prose-plus-ref blob here as one token that won't parse. If prose sits
    // before the last dash, the real ref is after it — peel the prose (scanning
    // it for a book name) and retry the tail.
    const dm = tok.match(LAST_DASH_RE)
    if (dm) {
      const cut = dm.index! + dm[0].length
      const prose = tok.slice(0, cut)
      const tail = tok.slice(cut)
      if (PROSE_HAN_RE.test(prose) && tail) {
        scanBook(prose, ctx)
        const tailRefs = parseRefList(tail, ctx)
        if (tailRefs.length > 0) {
          segs.push({ text: prose })
          segs.push({ text: tail, refs: tailRefs })
          continue
        }
      }
    }
    // No refs extracted — treat as prose rather than flagging it red.
    // The parser can't reliably tell "malformed ref" apart from "citation
    // of another book" or other dash-trailed prose ("…生命讀經，一七頁"),
    // so we err toward silent fall-through; a real ref failing to parse
    // will just render as plain text, which is acceptable.
    segs.push({ text: tok })
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
  /** Lines above 讀經 — lesson heading, centered in the renderer. */
  | { kind: 'title'; text: string }
  /** The `讀經：…` line — keeps the original prose so it can render verbatim
   * above the parsed verse list. */
  | { kind: 'reading'; text: string; refs: VerseRef[] }
  | { kind: 'week' }
  | { kind: 'point'; level: number; marker: string; segments: StudySegment[]; refs: VerseRef[] }

const READING_PREFIX_RE = /^讀經[:：]\s*/

/** One entry per input line (empties kept) so an editor can align lines 1:1. */
export function parseStudyLines(input: string): StudyLine[] {
  const ctx: ParseCtx = { book: null, chapter: null }
  const lines = normalizeOutlineText(input).split(/\r?\n/)

  // First pass: find the 讀經 line (if any) — non-empty lines above it become
  // title chunks; everything below behaves like a normal outline.
  let readingIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (READING_PREFIX_RE.test(lines[i].trim())) {
      readingIdx = i
      break
    }
  }

  return lines.map((raw, idx): StudyLine => {
    const line = raw.trim()
    if (!line) return { kind: 'empty' }

    // The 讀經 line itself: parse what follows the colon as a ref list, but
    // keep the original line so the renderer can show it verbatim.
    if (idx === readingIdx) {
      const tail = line.replace(READING_PREFIX_RE, '')
      return { kind: 'reading', text: line, refs: parseRefList(tail, ctx) }
    }

    // Anything before 讀經 is treated as title prose (centered, no refs).
    if (readingIdx > 0 && idx < readingIdx) {
      return { kind: 'title', text: line }
    }

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
