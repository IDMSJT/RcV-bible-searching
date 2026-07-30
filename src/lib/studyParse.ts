import { CANON } from '@/data/canon'
import { CN_NUMERAL_CLASS } from './chinese'
import { parseRefs } from './parseRefs'
import { type ParseCtx, type VerseRef } from './parseToken'

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
// The two deepest levels are parenthesised — 「（一）」 then 「（1）」. Their closing
// paren already separates marker from title, so no trailing separator is
// required; normalizeOutlineText has folded （） to () by the time this runs.
const MARKER_RE = new RegExp(
  '^(?:' +
    `(\\((?:${CN_NUMERAL_CLASS}|\\d+|[A-Za-z])\\))[　 、.．]*` +
    '|' +
    `([${MARKER_HEAD_CHARS}]+|${CN_NUMERAL_CLASS}|\\d+|[A-Za-z])[　 、.．]+` +
    ')(.*)$',
)
// 【週一】 (bracketed) is the legacy form; 「週　一」 (the char then a full /
// half-width space then the day character) is the newer copy-paste format.
// Both should render as the same centered small heading.
const WEEK_RE = /^(?:【\s*週|週[　\s]+[一二三四五六七日])/

// The deepest two levels are sometimes shipped as the precomposed enclosed
// numerals ㈠ / ⑴ instead of the spelled-out 「（一）」 / 「（1）」. Expand them so
// there is one marker shape to match (and to render) regardless of source.
const CN_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

// Normalise outline copy-paste: collapse the 啓/啟 character variants, expand
// the enclosed numerals, and fold fullwidth parens, so marker and book-name
// matching don't depend on the form the source happened to ship.
function normalizeOutlineText(input: string): string {
  return input
    .replace(/啓/g, '啟')
    .replace(/[㈠-㈩]/g, (c) => `(${CN_DIGITS[c.codePointAt(0)! - 0x3220]})`)
    .replace(/[⑴-⒇]/g, (c) => `(${c.codePointAt(0)! - 0x2473})`)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

// The published outlines run six deep: 壹 / 一 / 1 / a / （一） / （1）.
function levelFromMarker(mk: string): number {
  if (new RegExp(`^[${MARKER_HEAD_CHARS}]+$`).test(mk)) return 1
  if (/^[一二三四五六七八九十百]+$/.test(mk)) return 2
  if (/^\d+$/.test(mk)) return 3
  if (/^[A-Za-z]$/.test(mk)) return 4
  if (/^\([一二三四五六七八九十百]+\)$/.test(mk)) return 5
  if (/^\((?:\d+|[A-Za-z])\)$/.test(mk)) return 6
  return 6
}

export interface StudySegment {
  text: string
  /** Present when this segment is a reference token (empty array = unparseable). */
  refs?: VerseRef[]
}

function scanBook(text: string, ctx: ParseCtx): void {
  let found: string | null = null
  for (const m of text.matchAll(BOOK_NAME_RE)) found = m[1]
  if (found) ctx.book = NAME_TO_NO.get(found) ?? ctx.book
}

/** Segment one line's body, reusing the same scanning parser the footnotes and
 * cross-refs use. It anchors on book names and falls back to context-inheriting
 * continuations, so outline refs are found wherever they sit rather than only
 * after a dash or inside parens — an appositive heading like
 * 「新的一類—神人類—約一1」 needs no special handling, because the scan anchors on
 * 約 instead of trying to read the whole token in the previous line's book.
 *
 * `ctx` flows across lines: a full book name in the prose seeds it (so a bare
 * 「一17」 on a later line still resolves), and the last ref parsed carries the
 * book/chapter forward. */
function segmentLine(body: string, ctx: ParseCtx): StudySegment[] {
  scanBook(body, ctx)
  const { segments, refs } = parseRefs(body, ctx)
  const last = refs[refs.length - 1]
  if (last) {
    ctx.book = last.bookNo
    ctx.chapter = last.endChapter ?? last.chapter
  }
  return segments.map((seg) =>
    seg.refs && seg.refs.length > 0 ? { text: seg.text, refs: seg.refs } : { text: seg.text },
  )
}

export type StudyLine =
  | { kind: 'empty' }
  /** Lines above 讀經 — lesson heading, centered in the renderer. */
  | { kind: 'title'; text: string }
  /** The `讀經：…` line — keeps the original prose so it can render verbatim
   * above the parsed verse list. */
  | { kind: 'reading'; text: string; refs: VerseRef[] }
  | { kind: 'week' }
  | {
      kind: 'point'
      level: number
      marker: string
      /** The marker plus its separator, stripped off the body — prepend it to the
       * segments to recover the original line. */
      lead: string
      segments: StudySegment[]
      refs: VerseRef[]
    }

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
      const { refs } = parseRefs(tail, ctx)
      const tailLast = refs[refs.length - 1]
      if (tailLast) {
        ctx.book = tailLast.bookNo
        ctx.chapter = tailLast.endChapter ?? tailLast.chapter
      }
      return { kind: 'reading', text: line, refs }
    }

    // Anything before 讀經 is treated as title prose (centered, no refs).
    if (readingIdx > 0 && idx < readingIdx) {
      return { kind: 'title', text: line }
    }

    if (WEEK_RE.test(line)) return { kind: 'week' }
    const m = line.match(MARKER_RE)
    const marker = m ? (m[1] ?? m[2]) : ''
    // Split the marker off before scanning: an arabic marker ("1　在已過的…")
    // would otherwise parse as a verse in the inherited book. `lead` keeps the
    // marker with its original separator so the line can be rebuilt verbatim.
    const body = m ? m[3] : line
    const lead = m ? line.slice(0, line.length - body.length) : ''
    const segments = segmentLine(body, ctx)
    return {
      kind: 'point',
      level: marker ? levelFromMarker(marker) : 0,
      marker,
      lead,
      segments,
      refs: segments.flatMap((s) => s.refs ?? []),
    }
  })
}
