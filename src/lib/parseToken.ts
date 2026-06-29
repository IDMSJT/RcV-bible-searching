import { BOOK_ALIASES, BOOK_ALIAS_RE } from '@/data/bookAliases'
import { CN_NUMERAL_CHARS, CN_NUMERAL_CLASS, parseNum } from './chinese'

const CN = CN_NUMERAL_CLASS
const NUM = `(?:\\d+|${CN})`
// Also recognise em / en / fullwidth dashes as range separators so outline
// text written with `—`, `–`, or `－` (common in copy-pasted docs) doesn't
// fall through into a parse error.
const RANGE_CHARS = '\\-~～至到—–－'

export interface VerseRef {
  bookNo: number
  chapter: number
  /** End chapter — equals `chapter` unless the range crosses chapters
   * (十一36～十二5 → chapter=11, endChapter=12). */
  endChapter: number
  verseStart: number
  verseEnd: number
  /** 0 = 上, 1 = 下, 2 = 中, null = whole verse or range. Only meaningful when
   * the spec is a single verse (no range). */
  seg: number | null
  source: string
  /** Footnote index when the source ref carries a 「注N」 / 「註N」 suffix
   * (太一21注3). Only attached to the LAST ref in a multi-verse token, since
   * 「太一21、22注3」 can't disambiguate which verse the note belongs to. */
  note?: number
  /** True when 「注N」 attached DIRECTLY to the verse number with no
   * connector char in between — 「啟二一23註1」 → the note alone is the
   * target. 「啟二一23與註1」 → verse AND note are both targets. Only
   * meaningful when `note` or `noteAll` is set. */
  noteDirect?: boolean
  /** True when the source carried a bare 「注」 / 「註」 with NO number
   * (太八2註) — means "every footnote on this verse / range". Mutually
   * exclusive with `note`. Honours `noteDirect` the same way. */
  noteAll?: boolean
}

export interface ParseCtx {
  book: number | null
  chapter: number | null
}

// `<num>章` / `<num>篇` — explicit chapter unit
const CHAPTER_MARKER_RE = new RegExp(`^(${NUM})[章篇]`)
// `<num>:` / `<num>：` — colon notation
const CHAPTER_COLON_RE = new RegExp(`^(${NUM})[:：]`)
// `<CN>` directly followed by an arabic digit — compact form (約一1)
const CHAPTER_CN_BEFORE_ARABIC_RE = new RegExp(`^(${CN})(?=\\d)`)

// One vspec inside the verse list (after the chapter is consumed):
//   <num>[上下中]?(<rangeMark>(<endCN>)?<num>[上下中]?)?
// The range end may carry its own CN endChapter prefix to express a
// cross-chapter range (十一36～十二5 → end chapter 12, end verse 5).
const VERSE_SPEC_RE = new RegExp(
  `^(${NUM})([上下中])?(?:[${RANGE_CHARS}]([${CN_NUMERAL_CHARS}]+)?(${NUM})([上下中])?)?$`,
)

const STARTS_WITH_CN_RE = new RegExp(`^${CN}`)

export interface ParseTokenResult {
  ok: boolean
  refs: VerseRef[]
  reason?: string
}

/**
 * Parse one "post-comma-split" token into a list of refs, mutating the context
 * (book / chapter) so the next token can inherit. Supports:
 *
 *   - book aliases (約, 羅, 詩篇, …)
 *   - chapter forms: `<num>章`, `<num>篇`, `<num>:`, `<num>：`, or compact
 *     `<CN>` immediately before an arabic verse (約一1)
 *   - verse list separated by `、` inside the token (約十10下、12)
 *   - 上 / 下 segment markers on a single verse
 *   - range with `-`, `~`, `～`, `至`, `到` — optionally cross-chapter when the
 *     range end is prefixed by a CN chapter (十一36～十二5)
 *
 * Returns `ok=false` (with `refs=[]`) when the token can't yield any usable
 * reference; the caller chooses whether to surface that to the user (lookup
 * highlight) or silently drop it (study prose between refs).
 */
export function parseToken(token: string, ctx: ParseCtx): ParseTokenResult {
  let rest = token.trim().replace(/^參/, '').trim()
  if (!rest) return { ok: false, refs: [], reason: '空 token' }

  // 1. Optional book alias.
  let book = ctx.book
  const bm = rest.match(BOOK_ALIAS_RE)
  if (bm) {
    book = BOOK_ALIASES.get(bm[1]) ?? book
    rest = rest.slice(bm[1].length)
    // Book alias not followed by a CN chapter → assume chapter 1. Handles
    // single-chapter books written without a chapter number (猶24 = Jude 1:24)
    // and also the natural "default to chapter 1" shorthand.
    if (!STARTS_WITH_CN_RE.test(rest)) ctx.chapter = 1
  }

  // 2. Optional chapter (4 forms, priority order):
  let chapter = ctx.chapter
  let m: RegExpMatchArray | null
  if ((m = rest.match(CHAPTER_MARKER_RE))) {
    chapter = parseNum(m[1])
    rest = rest.slice(m[0].length)
  } else if ((m = rest.match(CHAPTER_COLON_RE))) {
    chapter = parseNum(m[1])
    rest = rest.slice(m[0].length)
  } else if ((m = rest.match(CHAPTER_CN_BEFORE_ARABIC_RE))) {
    chapter = parseNum(m[1])
    rest = rest.slice(m[1].length)
  }

  if (book == null) return { ok: false, refs: [], reason: '缺少書名' }
  if (chapter == null) return { ok: false, refs: [], reason: '缺少章' }

  // 3. Verse list — split on 、, each spec gets its own VerseRef. The footnote
  // chain is parsed PER-SPEC, not once at the end, so each verse in the list
  // can carry its own notes: 「二1注3、2注1」 → v1注3 AND v2注1. (A single
  // global strip would only catch the trailing 注1 and corrupt the rest.)
  const refs: VerseRef[] = []
  // `curChapter` tracks the start chapter of the NEXT vspec — a cross-chapter
  // range advances it so a later 、-spec without its own chapter continues from
  // the new chapter (二9～三2、5 → 第二章 9 節 to 第三章 2 節，then 第三章 5 節).
  let curChapter = chapter
  for (let vspec of rest.split('、')) {
    vspec = vspec.trim()
    if (!vspec) continue
    // Was the verse explicitly marked with 節? Captured before we strip it,
    // because it gates whether a *CN-numeral* verse is allowed (see below).
    const hadJie = vspec.includes('節')
    // Strip the 節 verse-unit wherever it sits — it shows up mid-token before a
    // 上/下 segment marker (「十八節下」), not only trailing (「十八節」). Also peel
    // any sentence punctuation that rode in on the final ref (「…十六節。」).
    vspec = vspec.replace(/節/g, '').replace(/[。．.\s]+$/, '')
    if (!vspec) continue

    // Peel this spec's trailing 「[連接符]注N」 chain. The first note's
    // connector decides the target: empty (二1注3) → direct (note IS the
    // target); non-empty (二1與注3) → connected (verse AND note). Extra notes
    // are additional note-only targets on the same verse. A bare 「注」 with no
    // number (太八2註) means EVERY note on the verse — represented as 'all'.
    // The `(?![一-鿿\d])` guard keeps a bare 注 from matching prose
    // words like 「註解」/「註釋」 (a CJK char after 注 → not a footnote ref).
    const noteChain: { n: number | 'all'; direct: boolean }[] = []
    const cm = vspec.match(/((?:[\s、，,與和及]*[注註]\s*(?:\d+|(?![一-鿿\d])))+)\s*$/)
    if (cm) {
      const itemRe = /([\s、，,與和及]*)[注註]\s*(\d+)?/g
      let im: RegExpExecArray | null
      while ((im = itemRe.exec(cm[1])) !== null) {
        if (im[0] === '') break // zero-width match guard
        noteChain.push({ n: im[2] ? Number(im[2]) : 'all', direct: im[1] === '' })
      }
      vspec = vspec.slice(0, cm.index!).trim().replace(/節$/, '')
    }

    const noteClone = (tpl: VerseRef, item: { n: number | 'all' }): VerseRef => {
      const r: VerseRef = { ...tpl, note: undefined, noteAll: undefined, noteDirect: true }
      if (item.n === 'all') r.noteAll = true
      else r.note = item.n
      return r
    }

    // A spec that is ONLY notes (no verse number left after the strip) —
    // 「二1注3、注4」 → the 「注4」 spec inherits the previous spec's verse, so
    // 注4 is read as another note on verse 1. Drop it if there's no prior ref.
    if (!vspec) {
      const prev = refs[refs.length - 1]
      if (prev) {
        for (const item of noteChain) refs.push(noteClone(prev, item))
      }
      continue
    }

    const vm = vspec.match(VERSE_SPEC_RE)
    if (!vm) continue
    // In this corpus verse numbers are arabic; a CN numeral that reached here
    // as a "verse" is almost always a prose count (三章七封書信 → 七封 = "seven
    // [epistles]", NOT verse 7). Only trust a CN verse when 節 marked it
    // (三章七節). Chapters still accept CN freely — this guards verses only.
    const verseIsCN = !/\d/.test(vm[1])
    if (verseIsCN && !hadJie) continue
    const vStart = parseNum(vm[1])
    if (vStart == null) continue
    const isRange = vm[4] != null
    // vm[3] is the optional CN endChapter prefix for cross-chapter ranges
    // (十一36～十二5). That heuristic only holds when verses are arabic; in an
    // all-CN range (十一至十二) the greedy prefix wrongly swallows the 十 of the
    // end verse, so fold it back into the verse and keep the current chapter.
    let endChapter = curChapter
    let endVerseStr = vm[4]
    if (vm[3]) {
      if (verseIsCN) endVerseStr = vm[3] + (vm[4] ?? '')
      else endChapter = parseNum(vm[3]) ?? curChapter
    }
    const vEnd = isRange ? (parseNum(endVerseStr ?? '') ?? vStart) : vStart
    const base: VerseRef = {
      bookNo: book,
      chapter: curChapter,
      endChapter,
      verseStart: vStart,
      verseEnd: vEnd,
      seg: isRange ? null : vm[2] === '上' ? 0 : vm[2] === '下' ? 1 : vm[2] === '中' ? 2 : null,
      source: vspec,
    }
    if (noteChain.length > 0) {
      const first = noteChain[0]
      if (first.n === 'all') base.noteAll = true
      else base.note = first.n
      base.noteDirect = first.direct
    }
    refs.push(base)
    // Each extra note clones the verse as its own note-only ref so the caller
    // renders one row per footnote.
    for (let k = 1; k < noteChain.length; k++) {
      refs.push(noteClone(base, noteChain[k]))
    }
    curChapter = endChapter
  }

  if (refs.length === 0) return { ok: false, refs: [], reason: '無有效節' }

  ctx.book = book
  ctx.chapter = curChapter
  return { ok: true, refs }
}
