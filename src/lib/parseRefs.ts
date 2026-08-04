import { BOOK_ALIASES } from '@/data/bookAliases'
import { CONTEXT_SEEDS } from './parseExceptions'
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

// 標題 (a psalm's superscription) is a word, not two characters a reference may
// use freely. Held out of REF_CHARS and allowed only as a whole suffix: with 題
// in the class, 「三五11題到國與王」 matched 「三五11題」, which parses as nothing, and
// the reference was lost. Most of the corpus' 題 stand alone like that.
const SUPERSCRIPTION_PAT = '(?:標題)?'

// Optional trailing chain of 「注N」 / 「註N」 footnote pointers. Eaten by the
// match so parseRefs consumes the full 「太一21注3」 / 「二1注3與注4」 as one
// segment; parseToken then peels the same suffix off and attaches each note.
// `*` (not `?`) so multiple notes on one verse stay in the same segment. A
// bare 注/註 (no number, 太八2註 = all notes) is allowed too, but only when
// what follows can't be more of a word — so prose like 「太八2註解」 doesn't get
// eaten. The conjunctions are exempt from that guard: 「太八2～4註與可一40～45註」
// joins two whole-verse note refs, and treating 與 as word-continuation there
// silently dropped the first 註 and linked the verses instead of their notes.
const NOTE_TAIL_PAT = `(?:[\\s、，,與和及]*[注註]\\s*(?:\\d+|(?!\\d)(?!(?![與和及])[一-鿿])))*`

// `^alias` then an optional English-style gap (a period and/or spaces, as in
// 「Matt. 5:1」) then any run of ref-chars. Case-insensitive so English aliases
// match any casing. The match string is handed to parseToken, which decides
// whether the whole thing is actually a valid ref.
const ANCHOR_FULL_RE = new RegExp(
  `^(?:${BOOK_PATTERN})[.\\s]*[${REF_CHARS}]*${SUPERSCRIPTION_PAT}${NOTE_TAIL_PAT}`,
  'i',
)

// Continuation: same kind of run, but must start with a digit or CN numeral so
// stray 上/下/章 chars don't get matched as ref starts.
const CONT_FULL_RE = new RegExp(
  `^[0-9${CN_NUMERAL_CHARS}][${REF_CHARS}]*${SUPERSCRIPTION_PAT}${NOTE_TAIL_PAT}`,
)

// Matches that look like a CN+節 ref but are actually proper nouns (Jewish
// festivals) that happen to share the shape. Only 七七節 (Pentecost / Feast
// of Weeks) collides — 一節/二節 are legitimate「verse N」 refs.
const PROSE_NOT_REF = new Set(['七七節'])

const SPELLED_CHAPTER_RE = new RegExp(`^[${CN_NUMERAL_CHARS}]+章`)

// A list of verses writes the 節 unit once, on the last item — 「十八、十九節」,
// 「四、五、九節」. Each item is scanned as its own token, so without this the
// earlier ones arrive at parseToken as bare CN numerals and its guard against
// prose counts (「三章七封書信」) discards them. Matched against what follows a
// token: a run of separated numerals that lands on 節 means this token is
// heading for one too.
const LIST_VERSE_TAIL_RE = new RegExp(
  `^(?:[、,，和及][0-9${CN_NUMERAL_CHARS}]+)+節`,
)

// 「每一節」「這一節」「上一節」 — the numeral counts sentences, not verses, so a
// bare 「一節」 after one of these is prose. 第 is absent on purpose: 「第一節」 is
// a real citation, and it is read before the scanner ever gets here.
const PROSE_QUANTIFIER = new Set(['每', '這', '那', '上', '下', '前', '後', '各', '同', '另', '該'])
const BARE_CN_VERSE_RE = new RegExp(`^[${CN_NUMERAL_CHARS}]+節[上下中]?$`)

// Prose spells a reference out with 第, and often 的 between the two halves:
// 「第一章的第一節」. The 第 keeps these out of REF_CHARS, which is why only the
// 「一節」 inside used to match — and it matched as a continuation, taking the
// chapter from whatever was cited last. Read whole, they carry their own.
const CN = CN_NUMERAL_CHARS
const ORDINAL_CV_RE = new RegExp(`^第([${CN}]+)章的?第([${CN}]+)節`)
const ORDINAL_V_RE = new RegExp(`^第([${CN}]+)節`)
const ORDINAL_C_RE = new RegExp(`^第[${CN}]+章`)

// Normalise outline-style copy-paste so anchor matching doesn't depend on the
// variant the source happened to ship (啓 vs 啟, full-width parens, …).
function normalize(t: string): string {
  return t
    .replace(/啓/g, '啟')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    // Fullwidth digits turn up mid-reference — 「約一１～3」 — and would otherwise
    // fail the whole run, since only ASCII digits are ref characters. Every swap
    // here is one glyph for one, which is what keeps the emitted segments lined
    // up with the caller's own text.
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
}

// A ref run can end up with the line's punctuation glued on: REF_CHARS has to
// contain 「:」 for 「3:16」, so 「啟三12、21：」 matches 「21：」 and then fails to
// parse. Trailing colons are never part of a reference, so drop them before
// handing the token over.
function trimRefTail(t: string): string {
  return t.replace(/[:：]+$/, '')
}

/** Where a note's citation context ends. A comma-separated run is one citation
 * — 「詩一百三十五11、一百三十六20」 stays in Psalms — so only a sentence ending
 * or a bracket edge breaks the chain. The colon is deliberately not here: it
 * introduces a list rather than closing one, and adding it changed nothing. */
const SENTENCE_END = '。！？；'

/** A run of verse numbers carrying the 節 unit and naming no chapter of its
 * own — 「17～18節」, 「25～27節」. */
const BARE_VERSE_RE = /^[0-9０-９一二三四五六七八九十百○]+(?:[～~—-][0-9０-９一二三四五六七八九十百○]+)?節/

/** Words that name the text being annotated rather than another place. 「本書」
 * is handled on its own below: it takes a chapter, where these two are already
 * standing in a chapter and take verses. */
const SELF_CHAPTER = ['本篇', '本章']

export interface ParseOptions {
  /** What kind of text this is, which decides what bounds a citation's context.
   *
   * `'note'` (the default) — a footnote. Brackets and sentence endings both
   * reset: each bracketed group is its own citation, and the prose that resumes
   * after one refers back to the verse being annotated. In a note on Genesis
   * 12:3 a bracket cites Galatians, and the 「二二18」 after it means Genesis
   * 22:18, not Galatians 22:18 — a chapter Galatians doesn't have. Over the
   * whole corpus these two rules take the citations landing on verses that
   * don't exist from 47 to 10.
   *
   * `'prose'` — running text, where neither bounds anything. A bracket is an
   * aside (「污靈(鬼)」) and the passage under discussion carries on past it;
   * so does a full stop, which is how a life-study message can name Matthew 12
   * in one sentence and write 「四十四節」 two sentences later. Resetting there
   * only lost references and gained nothing.
   *
   * `'list'` — nothing but citations, as a cross-reference is. A bracket here
   * groups a related citation rather than opening an aside, so the running book
   * carries through it: in 「太十三31～32（十七20）」 the bracketed verse is
   * Matthew 17:20. Bounding it read that as chapter 17 of the book being read,
   * which is how 「十七20」 came to point at a chapter Mark hasn't got. Across
   * all 58,655 cross-references the two modes disagree on exactly two, and both
   * are of this shape.
   *
   * Behaves as `'prose'` does today; it is named apart because the two are
   * different texts and the measurements point opposite ways. A book
   * introduction really is prose — 「（參王上六1，）… （四十17。）」 means verse
   * 40:17 of the book being introduced — and reading one as a list gets three
   * references wrong that bounding gets right. */
  kind?: 'note' | 'prose' | 'list'
  /** Character positions where the context starts over, on top of whatever
   * `kind` decides. The publisher marks its own citation blocks inside a note
   * (getFootnoteLinks); feeding their starts in here is what
   * scripts/check_footnote_links.py compares our reading against. Nothing in
   * the app passes this — see scripts/PARSE_EXCEPTIONS.md for why the blocks
   * are not imported. */
  cuts?: ReadonlySet<number>
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
export function parseRefs(
  input: string,
  initial?: ParseCtx,
  options?: ParseOptions,
): ParseResult {
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

  const bounded = (options?.kind ?? 'note') === 'note'

  let i = 0
  let lastProseStart = 0
  // Whether the bracket being read is one the context should end at. Decided
  // at the opening bracket and remembered for the closing one.
  let bracketBounds = true
  // How far a seeded context holds. Nothing resets inside it: the seed exists
  // precisely because the rules read this passage the other way, so leaving
  // them switched on would undo it a character later.
  let seedEnd = -1

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
    // A sentence ending, and both edges of a bracket, reset the context — see
    // `kind`, which turns this off for prose. Restoring the outer context on the
    // way out of a bracket was tried and is wrong here: a note's brackets hold
    // citations, and the prose between them belongs to the verse being
    // annotated, not to whatever the last bracket named.
    // A handful of passages leave out a book name the sentence plainly means,
    // in a shape the rules read the other way — see parseExceptions.
    for (const seed of CONTEXT_SEEDS) {
      if (text.startsWith(seed.find, i)) {
        ctx.book = seed.book
        ctx.chapter = seed.chapter
        seedEnd = i + seed.find.length
        break
      }
    }
    const seeded = i < seedEnd
    if (!seeded && options?.cuts?.has(i)) resetCtx()

    const ch = text[i]
    if (!seeded && bounded && (ch === '(' || ch === ')')) {
      // Only a bracket holding a citation ends the context. Plenty hold a gloss
      // instead — 「（二次）」, 「（見該處註2）」, 「（原文，眷顧）」 — and ending it
      // there drops the book the surrounding list was running in, which is how
      // 「二17、29，三4（二次）、7、8」 came to read 7 as chapter one's.
      if (ch === '(') {
        const close = text.indexOf(')', i)
        const inner = close < 0 ? text.slice(i + 1) : text.slice(i + 1, close)
        bracketBounds = parseRefs(inner, ctx, { kind: 'prose' }).refs.length > 0
      }
      if (bracketBounds) resetCtx()
    } else if (!seeded && bounded && SENTENCE_END.includes(ch)) {
      resetCtx()
    }

    // 「本篇」/「本章」 name the psalm or chapter being annotated, the way 「本書」
    // names its book: 「本篇18～19節」 in a note on Psalm 72 is 72:18-19, whatever
    // was cited before it. The context stays there afterwards, so a citation
    // following on — 「本章8～12節和十16～17」 — comes home too.
    if (initial?.book != null && SELF_CHAPTER.some((w) => text.startsWith(w, i))) {
      const m = CONT_FULL_RE.exec(text.slice(i + 2))
      if (m && m.index === 0 && /[0-9章篇節]/.test(m[0])) {
        const selfCtx: ParseCtx = { book: initial.book, chapter: initial.chapter ?? null }
        const out = parseToken(m[0], selfCtx)
        if (out.ok && out.refs.length > 0) {
          flushProse(i)
          const len = 2 + m[0].length
          segments.push({ text: input.slice(i, i + len), refs: out.refs })
          refs.push(...out.refs)
          ctx.book = selfCtx.book
          ctx.chapter = selfCtx.chapter
          i += len
          lastProseStart = i
          continue
        }
      }
    }

    // Verse numbers wearing the 節 unit and naming no chapter belong to the
    // chapter being annotated — 「來一10～12引用25～27節」 quotes the psalm the note
    // is on, not Hebrews. Not where a conjunction ties them to the citation
    // before: 「十一29～32和42～52節」 is two halves of one place.
    if (
      !seeded &&
      bounded &&
      initial?.book != null &&
      BARE_VERSE_RE.test(text.slice(i)) &&
      !'和與及'.includes(i > 0 ? text[i - 1] : '')
    ) {
      ctx.book = initial.book
      ctx.chapter = initial.chapter ?? null
    }

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
    // 「第一章的第一節」 and 「第一節」 — spelled out with 第, resolved against the
    // book in hand. A chapter on its own is left alone: it names no verse, and
    // stepping over it stops the numeral inside being read as one.
    const ordCV = ORDINAL_CV_RE.exec(text.slice(i))
    const ordV = ordCV ? null : ORDINAL_V_RE.exec(text.slice(i))
    if (ctx.book != null && (ordCV || ordV)) {
      const m = (ordCV ?? ordV)!
      const token = ordCV ? `${ordCV[1]}章${ordCV[2]}節` : `${ordV![1]}節`
      const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
      const out = parseToken(token, ctx)
      if (out.ok && out.refs.length > 0) {
        flushProse(i)
        segments.push({ text: input.slice(i, i + m[0].length), refs: out.refs })
        refs.push(...out.refs)
        i += m[0].length
        lastProseStart = i
        continue
      }
      ctx.book = snapshot.book
      ctx.chapter = snapshot.chapter
    }
    const ordC = ORDINAL_C_RE.exec(text.slice(i))
    if (ordC) {
      i += ordC[0].length
      continue
    }

    // A one-character alias in front of a spelled-out chapter is prose, not a
    // citation: 「但一章一節」 is 「但」 the conjunction followed by a chapter and
    // verse that carry on from the book named earlier, yet 但 is also the
    // abbreviation for Daniel. Across the notes and cross-references the short
    // abbreviations are always written compactly — 但三5, 445 times, against a
    // single spelled-out instance for any two-character alias and none at all
    // for a one-character one — so the spelled-out form belongs to full book
    // names and bare continuations. Falling through leaves 「一章一節」 to be read
    // as the continuation it is.
    if (BOOK_ALIASES.has(text[i]) && SPELLED_CHAPTER_RE.test(text.slice(i + 1))) {
      i += 1
      continue
    }

    const aMatch = ANCHOR_FULL_RE.exec(text.slice(i))
    if (aMatch && aMatch.index === 0 && /[0-9章篇節:：]|標題/.test(aMatch[0])) {
      const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
      const aTok = trimRefTail(aMatch[0])
      const out = parseToken(aTok, ctx, {
        verseUnit: LIST_VERSE_TAIL_RE.test(text.slice(i + aTok.length)),
      })
      if (out.ok && out.refs.length > 0) {
        flushProse(i)
        segments.push({ text: input.slice(i, i + aTok.length), refs: out.refs })
        refs.push(...out.refs)
        i += aTok.length
        lastProseStart = i
        continue
      }
      // Parse failed despite the alias matching — restore ctx so a false
      // positive like 「創作家」 doesn't leak chapter=1 into the next ref, and
      // step over the whole match. Leaving the digits behind let them be read
      // as a continuation of the ref before: 「太16:2，可2」 failed on 可2 for
      // want of a chapter, then matched the stranded 2 against Matthew 16 and
      // reported that verse twice.
      ctx.book = snapshot.book
      ctx.chapter = snapshot.chapter
      // Step over the whole match, but only where the alias reads as a citation
      // rather than as part of a word. Leaving the digits behind let them be
      // taken as a continuation of the ref before — 「太16:2，可2」 failed on 可2
      // for want of a chapter, then matched the stranded 2 against Matthew 16
      // and reported that verse twice. Skipping unconditionally was worse: in
      // 「以實瑪利—十六15」 the 利 of 以實瑪利 matches 利未記, and the reference
      // after it went with it. A separator in front is what tells them apart.
      const before = i > 0 ? text[i - 1] : ''
      if (
        (i === 0 || /[\s、，,;；:：(（"'\u201c\u201d]/.test(before)) &&
        /[0-9\u4e00-\u9fff]/.test(aTok.slice(1))
      ) {
        i += aMatch[0].length
        continue
      }
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
    if (ctx.book != null && prev !== '注' && prev !== '註') {
      const cMatch = CONT_FULL_RE.exec(text.slice(i))
      // Step past blocklisted prose so the scanner doesn't try to re-match
      // a shorter sub-string of it — without this, 「七七節」 gets skipped
      // here but the inner 「七節」 starting one char later would still
      // match and incorrectly link as verse 7.
      if (cMatch && cMatch.index === 0 && PROSE_NOT_REF.has(cMatch[0])) {
        i += cMatch[0].length
        continue
      }
      // Without a chapter in context the run has to supply its own — 「一17」
      // after 「羅馬書」 names Rom 1:17, whereas a bare 「17」 would be a verse
      // in a chapter we don't know yet.
      const cTok = cMatch && cMatch.index === 0 ? trimRefTail(cMatch[0]) : ''
      if (cTok && PROSE_QUANTIFIER.has(prev) && BARE_CN_VERSE_RE.test(cTok)) {
        i += cTok.length
        continue
      }
      const selfChapter = /^[^0-9]+[0-9]|[章篇:：]|標題/.test(cTok)
      // A bare CN numeral has to earn its place: a digit, or a unit that says
      // what it counts. Otherwise 「五位婦女」 reads as verse 5. The unit can be
      // the list's, written once at the end — that is what lets the 八 of
      // 「八、九節」 through while 「五位」 stays prose.
      const listVerse = LIST_VERSE_TAIL_RE.test(text.slice(i + cTok.length))
      if (
        cTok &&
        (ctx.chapter != null || selfChapter) &&
        (listVerse || /[0-9章篇節]|標題/.test(cTok))
      ) {
        const snapshot: ParseCtx = { book: ctx.book, chapter: ctx.chapter }
        const out = parseToken(cTok, ctx, { verseUnit: listVerse })
        if (out.ok && out.refs.length > 0) {
          flushProse(i)
          segments.push({
            text: input.slice(i, i + cTok.length),
            refs: out.refs,
          })
          refs.push(...out.refs)
          i += cTok.length
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
