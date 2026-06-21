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
const REF_CHARS = `0-9${CN_NUMERAL_CHARS}上下章篇節:：~～\\-至到—–－`

// `^alias` followed by any run of ref-chars. The match string is then handed to
// parseToken, which decides whether the whole thing is actually a valid ref.
const ANCHOR_FULL_RE = new RegExp(`^(?:${BOOK_PATTERN})[${REF_CHARS}]*`)

// Continuation: same kind of run, but must start with a digit or CN numeral so
// stray 上/下/章 chars don't get matched as ref starts.
const CONT_FULL_RE = new RegExp(`^[0-9${CN_NUMERAL_CHARS}][${REF_CHARS}]*`)

// Separators between refs (also between an anchor and its continuation refs).
const SEP_RE = /^[\s,，、；;]+/

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
export function parseRefs(input: string): ParseResult {
  const text = normalize(input)
  const refs: VerseRef[] = []
  const segments: Segment[] = []
  const errors: ParseError[] = []
  const ctx: ParseCtx = { book: null, chapter: null }

  let i = 0
  let lastProseStart = 0

  function flushProse(end: number): void {
    if (lastProseStart < end) {
      segments.push({ text: text.slice(lastProseStart, end) })
    }
  }

  while (i < text.length) {
    // 1. Anchor — alias-led ref.
    const aMatch = ANCHOR_FULL_RE.exec(text.slice(i))
    if (aMatch && aMatch.index === 0) {
      const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
      const out = parseToken(aMatch[0], ctx)
      if (out.ok && out.refs.length > 0) {
        flushProse(i)
        segments.push({ text: aMatch[0], refs: out.refs })
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
    if (ctx.book != null && ctx.chapter != null) {
      const sepMatch = SEP_RE.exec(text.slice(i))
      if (sepMatch && sepMatch.index === 0) {
        const afterSep = i + sepMatch[0].length
        const cMatch = CONT_FULL_RE.exec(text.slice(afterSep))
        if (cMatch && cMatch.index === 0) {
          const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
          const out = parseToken(cMatch[0], ctx)
          if (out.ok && out.refs.length > 0) {
            flushProse(i)
            segments.push({ text: text.slice(i, afterSep) }) // sep as prose
            segments.push({ text: cMatch[0], refs: out.refs })
            refs.push(...out.refs)
            i = afterSep + cMatch[0].length
            lastProseStart = i
            continue
          }
          ctx.book = snapshot.book
          ctx.chapter = snapshot.chapter
        }
      }
    }

    i++
  }

  flushProse(text.length)
  return { refs, segments, errors }
}
