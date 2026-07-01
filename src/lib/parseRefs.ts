import { BOOK_ALIASES } from '@/data/bookAliases'
import { CANON } from '@/data/canon'
import { CN_NUMERAL_CHARS } from './chinese'
import { parseToken, type ParseCtx, type VerseRef } from './parseToken'

export type { VerseRef } from './parseToken'

export interface Segment {
  text: string
  /** Present for substrings recognised as a reference. May contain >1 ref
   * when one source token expands into a verse list (e.g. "創一1、5"). */
  refs?: VerseRef[]
}

export interface ParseError {
  token: string
  reason: string
}

export interface ParseResult {
  refs: VerseRef[]
  segments: Segment[]
  errors: ParseError[]
}

// Union of every recognised book name (short aliases + full canon names),
// longest-first so 「彼後」 / 「林前」 are tried before the shorter prefixes.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
const ALL_BOOK_NAMES = (() => {
  const set = new Set<string>()
  for (const k of BOOK_ALIASES.keys()) set.add(k)
  for (const b of CANON) set.add(b.name)
  return [...set].sort((a, b) => b.length - a.length)
})()
const BOOK_PATTERN = ALL_BOOK_NAMES.map(escapeRe).join('|')

// Character class for "could-be-part-of-a-ref" after a book alias / inside a
// continuation. Excludes 、 deliberately so a compound like 「創一1、5」 gets
// matched as the anchor 「創一1」 and the continuation loop picks up 「5」
// separately — that way each verse becomes its own segment and can be
// individually hovered / highlighted in the backdrop.
const REF_CHARS = `0-9${CN_NUMERAL_CHARS}上下中章篇節:：~～\\-至到—–－`

// Optional trailing chain of 「注N」 / 「註N」 footnote pointers. Eaten by the
// match so parseRefs consumes the full 「太一21注3」 / 「二1注3與注4」 as one
// segment; parseToken then peels the same suffix off and attaches each note.
// `*` (not `?`) so multiple notes on one verse stay in the same segment. A
// bare 注/註 (no number, 太八2註 = all notes) is allowed too, but only when
// NOT followed by a CJK char — so prose like 「太八2註解」 doesn't get eaten.
const NOTE_TAIL_PAT = `(?:[\\s、，,與和及]*[注註]\\s*(?:\\d+|(?![一-鿿\\d])))*`

// `^alias` then an optional English-style gap (a period and/or spaces, as in
// 「Matt. 5:1」) then any run of ref-chars. Case-insensitive so English aliases
// match any casing. The match string is handed to parseToken, which decides
// whether the whole thing is actually a valid ref.
const ANCHOR_FULL_RE = new RegExp(
  `^(?:${BOOK_PATTERN})[.\\s]*[${REF_CHARS}]*${NOTE_TAIL_PAT}`,
  'i',
)

// Continuation: same kind of run, but must start with a digit or CN numeral so
// stray 上/下/章 chars don't get matched as ref starts.
const CONT_FULL_RE = new RegExp(`^[0-9${CN_NUMERAL_CHARS}][${REF_CHARS}]*${NOTE_TAIL_PAT}`)

// Matches that look like a CN+節 ref but are actually proper nouns (Jewish
// festivals) that happen to share the shape. Only 七七節 (Pentecost / Feast
// of Weeks) collides — 一節/二節 are legitimate「verse N」 refs.
const PROSE_NOT_REF = new Set(['七七節'])

// Normalise outline-style copy-paste so anchor matching doesn't depend on the
// variant the source happened to ship (啓 vs 啟, full-width parens, …).
function normalize(t: string): string {
  return t.replace(/啓/g, '啟').replace(/（/g, '(').replace(/）/g, ')')
}

/**
 * Scanning ref parser.
 *
 * Walks the input one character at a time. At each position:
 *   1. Try to match an anchor (book alias followed by ref chars). If it parses
 *      via parseToken, consume that exact length and move on.
 *   2. Otherwise, if we already have book/chapter context from a prior anchor,
 *      try to skip a separator and match a continuation (ref-chars-only run
 *      starting with a digit or CN numeral). If it parses, consume both the
 *      separator and the continuation.
 *   3. Otherwise just `i++`.
 *
 * This means anything outside an anchor or continuation is silently treated as
 * prose — leading garbage like "lk：", trailing punctuation like "。" or
 * brackets, and stray words mid-text all just flow into prose segments without
 * tripping up the surrounding refs.
 */
export function parseRefs(input: string, initial?: ParseCtx): ParseResult {
  // `text` is the normalised form used for matching (啓→啟, （→(); offsets
  // line up 1:1 with `input` because every normalisation is a same-length
  // glyph swap. Emitted segments use `input` slices so the caller sees the
  // user's original punctuation, not our matcher-friendly variant.
  //
  // `initial` seeds the parse context — pass the current book/chapter when
  // parsing footnote text so refs like 「十八20」 inside a Matthew 1 note
  // resolve to Matt 18:20 rather than dropping for lack of a book.
  const text = normalize(input)
  const refs: VerseRef[] = []
  const segments: Segment[] = []
  const errors: ParseError[] = []
  const ctx: ParseCtx = {
    book: initial?.book ?? null,
    chapter: initial?.chapter ?? null,
  }

  let i = 0
  let lastProseStart = 0

  function flushProse(end: number): void {
    if (lastProseStart < end) {
      segments.push({ text: input.slice(lastProseStart, end) })
    }
  }

  const resetCtx = () => {
    ctx.book = initial?.book ?? null
    ctx.chapter = initial?.chapter ?? null
  }

  while (i < text.length) {
    // Paren boundaries reset the parse context. Each bracketed group reads
    // as its own scope: 「…（路三23～38。）…（1，16～17。）」 — the second
    // bracket means 太1:1, 太1:16~17 (the verse we're annotating), not Luke
    // continuing from the first bracket. The paren itself doesn't match an
    // anchor or continuation, so we just reset and fall through to i++.
    const ch = text[i]
    if (ch === '(' || ch === ')') resetCtx()

    // 「本書」 = the book this note belongs to — the *initial* context book, not
    // whatever book was last cited (「…來十三16，與本書十二13…」 means Romans, the
    // note's own book, not Hebrews). Standalone 書 is 約書亞記's abbreviation, so
    // 「本書十二13」 would otherwise anchor as Joshua. Read the ref run after 本書 in
    // the note's book and link the whole 「本書…」 phrase.
    if (initial?.book != null && text.startsWith('本書', i)) {
      const m = CONT_FULL_RE.exec(text.slice(i + 2))
      if (m && m.index === 0 && /[0-9章篇節]/.test(m[0])) {
        const benCtx: ParseCtx = { book: initial.book, chapter: null }
        const out = parseToken(m[0], benCtx)
        if (out.ok && out.refs.length > 0) {
          flushProse(i)
          const len = 2 + m[0].length
          segments.push({ text: input.slice(i, i + len), refs: out.refs })
          refs.push(...out.refs)
          // Following continuations now flow in the 本書 book/chapter.
          ctx.book = benCtx.book
          ctx.chapter = benCtx.chapter
          i += len
          lastProseStart = i
          continue
        }
      }
    }

    // 1. Anchor — alias-led ref. Same digit / unit-marker guard as the
    // continuation branch: 「出一」 in 「伸出一隻手」 looks like
    // alias-Exo + CN-one to the matcher but the 「一」 is the prose word
    // for 'one', not a chapter / verse number. Require at least one
    // arabic digit or 章/篇/節/: so we keep that match as prose.
    const aMatch = ANCHOR_FULL_RE.exec(text.slice(i))
    if (aMatch && aMatch.index === 0 && /[0-9章篇節:：]/.test(aMatch[0])) {
      const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
      const out = parseToken(aMatch[0], ctx)
      if (out.ok && out.refs.length > 0) {
        flushProse(i)
        segments.push({ text: input.slice(i, i + aMatch[0].length), refs: out.refs })
        refs.push(...out.refs)
        i += aMatch[0].length
        lastProseStart = i
        continue
      }
      // Parse failed despite the alias matching — restore ctx so a false
      // positive like 「創作家」 doesn't leak chapter=1 into the next ref.
      ctx.book = snapshot.book
      ctx.chapter = snapshot.chapter
    }

    // 2. Continuation — verse-only / chapter-change ref that inherits ctx.
    // No separator requirement: CONT_FULL_RE already gates on a leading
    // digit / CN numeral, so 「十八20」 buried mid-prose still parses. We
    // additionally require the match to contain an arabic digit or a
    // chapter/verse unit marker (章/篇/節) — otherwise a stray CN like
    // 「五」 in 「五位婦女」 (the prose 「five」) would itself parse as a
    // verse number and turn into a link.
    //
    // Skip if the previous char is 注/註 — 「20注3」 means verse 20 note 3,
    // the trailing 3 is a footnote number, not another verse continuation.
    // The renderer's post-processing then merges 「20」 + 「注3」 into one
    // link with `?note=20:3` so the destination chapter expands that note.
    const prev = i > 0 ? text[i - 1] : ''
    if (ctx.book != null && ctx.chapter != null && prev !== '注' && prev !== '註') {
      const cMatch = CONT_FULL_RE.exec(text.slice(i))
      // Step past blocklisted prose so the scanner doesn't try to re-match
      // a shorter sub-string of it — without this, 「七七節」 gets skipped
      // here but the inner 「七節」 starting one char later would still
      // match and incorrectly link as verse 7.
      if (cMatch && cMatch.index === 0 && PROSE_NOT_REF.has(cMatch[0])) {
        i += cMatch[0].length
        continue
      }
      if (cMatch && cMatch.index === 0 && /[0-9章篇節]/.test(cMatch[0])) {
        const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
        const out = parseToken(cMatch[0], ctx)
        if (out.ok && out.refs.length > 0) {
          flushProse(i)
          segments.push({
            text: input.slice(i, i + cMatch[0].length),
            refs: out.refs,
          })
          refs.push(...out.refs)
          i += cMatch[0].length
          lastProseStart = i
          continue
        }
        ctx.book = snapshot.book
        ctx.chapter = snapshot.chapter
      }
    }

    i++
  }

  flushProse(input.length)
  return { refs, segments, errors }
}
