import { describe, expect, it } from 'vitest'
import { CONTEXT_SEEDS } from './parseExceptions'
import { parseRefs } from './parseRefs'
import type { VerseRef } from './parseToken'

// Compact ref signature so a single string per ref describes everything
// that matters. Format examples:
//   '40:1:1'        Matt 1:1
//   '40:1:1-3'      Matt 1:1-3
//   '40:1-2:36-5'   Matt 1:36~2:5  (cross-chapter range)
//   '40:1:1下'       Matt 1:1下     (segment marker)
//   '66:21:23註1'   Rev 21:23 with direct 註1
//   '66:21:23與註1' Rev 21:23 with connected 與註1
function sig(r: VerseRef): string {
  const ch =
    r.endChapter !== r.chapter ? `${r.chapter}-${r.endChapter}` : `${r.chapter}`
  let v = `${r.verseStart}`
  if (r.verseEnd !== r.verseStart) v += `-${r.verseEnd}`
  if (r.seg === 0) v += '上'
  else if (r.seg === 1) v += '下'
  if (r.noteAll) v += r.noteDirect ? '註all' : '與註all'
  else if (r.note != null) v += r.noteDirect ? `註${r.note}` : `與註${r.note}`
  return `${r.bookNo}:${ch}:${v}`
}

const sigs = (text: string) => parseRefs(text).refs.map(sig)

describe('parseRefs — anchors', () => {
  it('alias + CN-chapter + arabic-verse', () => {
    expect(sigs('太一1')).toEqual(['40:1:1'])
  })

  it('alias + chapter via 章', () => {
    expect(sigs('太1章1節')).toEqual(['40:1:1'])
  })

  it('alias + colon notation', () => {
    expect(sigs('太1:1')).toEqual(['40:1:1'])
  })

  it('alias + 篇 (Psalms-style)', () => {
    expect(sigs('詩48篇2')).toEqual(['19:48:2'])
  })

  it('circle-zero chapter numeral (詩一○三7 = Ps 103:7)', () => {
    // The source uses ○ (U+25CB) — and sometimes 〇 (U+3007) — as positional
    // zero, so 「一○三」 must parse to chapter 103.
    expect(sigs('（詩一○三7。）')).toEqual(['19:103:7'])
    expect(sigs('詩一〇三7')).toEqual(['19:103:7'])
  })

  it('撒迦利亞 abbreviates to 亞 (not 撒, which is Samuel)', () => {
    expect(sigs('亞一1')).toEqual(['38:1:1'])
    expect(sigs('撒上一1')).toEqual(['9:1:1'])
    expect(sigs('撒下一1')).toEqual(['10:1:1'])
  })

  it('那鴻 abbreviates to 鴻; bare 那 is prose, not a book', () => {
    expect(sigs('鴻一1')).toEqual(['34:1:1'])
    expect(sigs('那時候我們')).toEqual([])
  })

  it('single-chapter book without chapter number', () => {
    // Jude has only one chapter; bare 「猶24」 should resolve to Jude 1:24.
    expect(sigs('猶24')).toEqual(['65:1:24'])
  })
})

describe('parseRefs — continuations', () => {
  it('comma-separated verses under one anchor', () => {
    expect(sigs('太一1、5、10')).toEqual(['40:1:1', '40:1:5', '40:1:10'])
  })

  it('cross-anchor flow with new chapter on second token', () => {
    // 太一1，二5 → ctx carries 太 across the comma; the 二 sets new chapter.
    expect(sigs('太一1，二5')).toEqual(['40:1:1', '40:2:5'])
  })

  it('verse range', () => {
    expect(sigs('太一1-3')).toEqual(['40:1:1-3'])
  })

  it('cross-chapter verse range', () => {
    // 太一36～二5 → start chapter 1 v36, end chapter 2 v5.
    expect(sigs('太一36～二5')).toEqual(['40:1-2:36-5'])
  })

  it('segment marker on a single verse', () => {
    expect(sigs('太一1下')).toEqual(['40:1:1下'])
  })

  it('continuation inside prose with no separator', () => {
    // 「見十八20」 inside a Matthew-context note resolves to Matt 18:20.
    expect(parseRefs('見十八20', { book: 40, chapter: 1 }).refs.map(sig)).toEqual([
      '40:18:20',
    ])
  })
})

describe('parseRefs — false positives that must stay prose', () => {
  it('七七節 (Pentecost) is not 七節 / verse 7', () => {
    expect(sigs('守七七節')).toEqual([])
  })

  it('出一隻手 — alias 出 + CN-one is not Exodus 1', () => {
    expect(sigs('伸出一隻手')).toEqual([])
  })

  it('五位婦女 — bare CN-five is not verse 5', () => {
    expect(parseRefs('五位婦女', { book: 40, chapter: 1 }).refs.map(sig)).toEqual([])
  })

  it('三章七封書信 — CN 「七」 is a prose count (七封), not verse 7', () => {
    // 「三章」 is a real chapter, but 「七」 here begins 「七封書信」 (seven
    // epistles). A CN verse with no 節 marker must not link.
    expect(parseRefs('二、三章七封書信所記的', { book: 66, chapter: 1 }).refs).toEqual([])
  })

  it('CN verse still links when 節 marks it (三章七節)', () => {
    expect(parseRefs('三章七節', { book: 66, chapter: 1 }).refs.map(sig)).toEqual(['66:3:7'])
  })

  it('continuation does NOT match the 3 in 「20注3」 as verse 3', () => {
    // Parser now consumes 20注3 as one ref with note=3 (direct). The point
    // is the trailing 3 doesn't become a separate verse.
    const r = parseRefs('20注3', { book: 40, chapter: 1 }).refs.map(sig)
    expect(r).toEqual(['40:1:20註3'])
  })
})

describe('parseRefs — 注N / 註N footnote pointer', () => {
  it('direct attach: alias + verse + 注N', () => {
    expect(sigs('太一21注3')).toEqual(['40:1:21註3'])
  })

  it('direct attach: alias + verse + 註N (variant glyph)', () => {
    expect(sigs('啟二一23註1')).toEqual(['66:21:23註1'])
  })

  it('connected attach via 與', () => {
    expect(sigs('啟二一23與註1')).toEqual(['66:21:23與註1'])
  })

  it('connected attach via whitespace', () => {
    expect(sigs('太一21 註3')).toEqual(['40:1:21與註3'])
  })

  it('attaches to the LAST ref in a multi-verse token', () => {
    // 太一21、22註3 → both verses parse; note goes on verse 22.
    expect(sigs('太一21、22註3')).toEqual(['40:1:21', '40:1:22註3'])
  })

  it('chain of notes on one verse stays in one segment (二1注3與注4)', () => {
    // The 與注4 must NOT be dropped — both notes on verse 1.
    expect(parseRefs('參二1注3與注4', { book: 43, chapter: 1 }).refs.map(sig)).toEqual([
      '43:2:1註3',
      '43:2:1註4',
    ])
  })

  it('bare 註 = all notes (太八2註)', () => {
    expect(sigs('太八2註')).toEqual(['40:8:2註all'])
  })

  it('bare 註 on a range = all notes of the range (太八2～4註)', () => {
    expect(sigs('太八2～4註')).toEqual(['40:8:2-4註all'])
  })

  it('太八2與2註 → verse + all-notes (與 before a digit splits)', () => {
    expect(sigs('太八2與2註')).toEqual(['40:8:2', '40:8:2註all'])
  })

  it('bare 註 followed by a CJK char stays prose (太八2註解 → just the verse)', () => {
    // 註解 is the word "annotation" — the 註 must not be eaten as a footnote.
    expect(sigs('太八2註解')).toEqual(['40:8:2'])
  })
})

describe('parseRefs — paren-scope context reset', () => {
  it('「(...) (...)」 — second bracket does NOT inherit the first bracket book', () => {
    // First bracket sets Luke 3:23. Second bracket has no alias — without
    // the reset, the 1,16~17 spec would resolve to Luke 1:1 + Luke 1:16-17.
    // With the reset, the second bracket falls back to the initialCtx
    // (Matt 1 here, since we're rendering a Matthew note body), so 1,16~17
    // means Matt 1:1 + Matt 1:16-17.
    const refs = parseRefs(
      '前段（路三23～38。）後段（1，16～17。）',
      { book: 40, chapter: 1 },
    ).refs.map(sig)
    expect(refs).toEqual([
      '42:3:23-38',
      '40:1:1',
      '40:1:16-17',
    ])
  })
})

describe('parseRefs — a sentence ending closes a note\'s citation', () => {
  it('a comma-separated run stays in the book it named', () => {
    // The book is written once and the rest of the list continues from it —
    // this is the case a distance-based cutoff got wrong.
    expect(sigs('詩一百三十五11、一百三十六20、六八15')).toEqual([
      '19:135:11',
      '19:136:20',
      '19:68:15',
    ])
  })

  it('the next sentence starts from the annotated verse again', () => {
    // Leviticus 1 is cited, the sentence ends, and the bare verse numbers that
    // follow belong to the chapter the note is on.
    const refs = parseRefs('見利一8。又8節、13節。', { book: 3, chapter: 3 }).refs.map(sig)
    expect(refs).toEqual(['3:1:8', '3:3:8', '3:3:13'])
  })

  it('prose carries the passage across a full stop', () => {
    // A life-study message names the chapter once and goes on discussing it,
    // so nothing there bounds the context.
    const refs = parseRefs('太十二43。四十四節', { book: 40, chapter: null }, { kind: 'prose' })
      .refs.map(sig)
    expect(refs).toEqual(['40:12:43', '40:12:44'])
  })
})

describe('parseRefs — normalisation', () => {
  it('啓 normalises to 啟', () => {
    expect(sigs('啓二一23')).toEqual(['66:21:23'])
  })

  it('full-width parens normalise to half-width (paren-scope still resets)', () => {
    const refs = parseRefs(
      '（路三23）（1）',
      { book: 40, chapter: 1 },
    ).refs.map(sig)
    expect(refs).toEqual(['42:3:23', '40:1:1'])
  })

  it('English RcV abbreviations, with period + space, ; separators, continuation', () => {
    expect(sigs('Matt. 5:1; 28:19; 2 Cor. 6:14-16; 1 Cor. 1:2; 1 Pet. 4:16')).toEqual([
      '40:5:1',
      '40:28:19', // continuation inherits Matthew
      '47:6:14-16',
      '46:1:2',
      '60:4:16',
    ])
  })

  it('English aliases are case-insensitive', () => {
    expect(sigs('rom 8:28; JOHN 3:16')).toEqual(['45:8:28', '43:3:16'])
  })

  it('本書 = the note\'s own book, not the last-cited one (書 ≠ 約書亞記)', () => {
    // A Romans 15 note: 本書 must resolve to Romans (45), even though Hebrews
    // (來) was cited just before, and 書 alone must not anchor as 約書亞記 (6).
    const refs = parseRefs('與來十三16，與本書十二13者同字根', {
      book: 45,
      chapter: 15,
    }).refs.map(sig)
    expect(refs).toEqual(['58:13:16', '45:12:13'])
  })
})

describe('parseRefs — 詩篇標題 in prose', () => {
  it('links a superscription ref', () => {
    expect(sigs('見詩三四標題。')).toEqual(['19:34:0'])
  })

  it('a following 標題 keeps the book but takes its own chapter', () => {
    expect(sigs('詩五七標題，一四二標題')).toEqual(['19:57:0', '19:142:0'])
  })

  it('the citation is one segment, punctuation stays prose', () => {
    const segs = parseRefs('見詩三四標題。').segments.map((s) => s.text)
    expect(segs).toEqual(['見', '詩三四標題', '。'])
  })

  it('prose ending in 標題 without a chapter is left alone', () => {
    expect(sigs('這是本書的標題')).toEqual([])
  })
})

describe('parseRefs — bare 註 joined by a conjunction', () => {
  it('keeps 註all on both sides of 與', () => {
    // 「見太八2～4註與可一40～45註」 cites the notes on both passages. 與 is a
    // conjunction here, not the start of a word, so the first 註 must survive.
    expect(sigs('見太八2～4註與可一40～45註。')).toEqual([
      '40:8:2-4註all',
      '41:1:40-45註all',
    ])
  })

  it('a comma-joined pair behaves the same', () => {
    expect(sigs('太八2～4註，可一40～45註')).toEqual([
      '40:8:2-4註all',
      '41:1:40-45註all',
    ])
  })

  it('still refuses to eat 註 that starts a word', () => {
    // 「註解」 is prose — the verse links, the word does not become a note ref.
    expect(sigs('太八2註解說明')).toEqual(['40:8:2'])
  })
})

describe('parseRefs — an unresolvable bare number stays prose', () => {
  it('does not link 太16 in running text', () => {
    expect(sigs('見太16')).toEqual([])
  })

  it('still links the one-chapter shorthand', () => {
    expect(sigs('見猶24')).toEqual(['65:1:24'])
  })

  it('links it once the chapter is spelled out', () => {
    expect(sigs('見太十六16')).toEqual(['40:16:16'])
  })
})

describe('parseRefs — naming a book starts its own chapter context', () => {
  it('does not lend one book\'s chapter to the next', () => {
    // 「可2」 has no chapter of its own and Mark has sixteen, so it can't be
    // resolved — and Matthew 16 must not stand in for it.
    expect(sigs('太16:2，可2')).toEqual(['40:16:2'])
  })

  it('resolves once the second ref carries its own chapter', () => {
    expect(sigs('太16:2，可3:2')).toEqual(['40:16:2', '41:3:2'])
    expect(sigs('太16:2，可一2')).toEqual(['40:16:2', '41:1:2'])
  })

  it('a bare verse still continues the ref before it', () => {
    expect(sigs('創一1、5')).toEqual(['1:1:1', '1:1:5'])
  })

  it('leaves an alias-shaped word alone', () => {
    expect(sigs('創作家一定')).toEqual([])
  })
})

describe('parseRefs — a verse list writes 節 once, at the end', () => {
  it('reads the earlier items as verses too', () => {
    // 「十八」 arrives at parseToken as a bare CN numeral, which it discards as a
    // prose count unless something says it is a verse. The 節 the list is
    // heading towards is what says so.
    expect(sigs('在馬太二十八章十八、十九節')).toEqual(['40:28:18', '40:28:19'])
    expect(sigs('馬太十一章二十八、二十九節')).toEqual(['40:11:28', '40:11:29'])
    expect(sigs('約翰一章四、五、九節')).toEqual(['43:1:4', '43:1:5', '43:1:9'])
  })

  it('works for a continuation that inherits its chapter', () => {
    const refs = parseRefs('在八、九節約翰說', { book: 40, chapter: 3 }).refs.map(sig)
    expect(refs).toEqual(['40:3:8', '40:3:9'])
  })

  it('still refuses a CN numeral that no 節 is coming for', () => {
    // 「七封」 counts epistles. Nothing downstream turns it into verse 7.
    expect(sigs('啟示錄三章七封書信')).toEqual([])
  })
})

describe('parseRefs — 「每一節」 counts verses, it does not cite one', () => {
  const cases = ['每一節', '這一節', '上一節', '下一節', '前一節', '同二節', '各三節']
  for (const c of cases) {
    it(`leaves 「${c}」 as prose`, () => {
      expect(parseRefs(c, { book: 40, chapter: 1 }).refs).toEqual([])
    })
  }

  it('still reads the ordinal form as a citation', () => {
    const refs = parseRefs('第一節說', { book: 40, chapter: 1 }).refs.map(sig)
    expect(refs).toEqual(['40:1:1'])
  })

  it('leaves a citation that merely follows one of those words alone', () => {
    // The guard keys on the word directly before the numeral, so a real
    // reference later in the sentence is untouched.
    const refs = parseRefs('下一節說到二十節', { book: 40, chapter: 5 }).refs.map(sig)
    expect(refs).toEqual(['40:5:20'])
  })
})

describe('parseRefs — 標題 is a word, not two reference characters', () => {
  it('leaves the 題 of 「題到」 out of the reference', () => {
    // 「題」 was in the character class a reference run may use, for the sake of
    // a psalm's 標題, so 「三五11題」 was matched whole and parsed as nothing.
    expect(parseRefs('三五11題到國與王', { book: 1, chapter: 17 }).refs.map(sig)).toEqual([
      '1:35:11',
    ])
    expect(parseRefs('13～14節題到兩種焚燒', { book: 2, chapter: 29 }).refs.map(sig)).toEqual([
      '2:29:13-14',
    ])
  })

  it('still reads a superscription', () => {
    expect(sigs('詩三標題')).toEqual(['19:3:0'])
    expect(sigs('詩五一標題')).toEqual(['19:51:0'])
  })
})

describe("kind: 'list'", () => {
  const at = (t: string, kind: 'note' | 'list') =>
    parseRefs(t, { book: 41, chapter: 4 }, { kind }).refs.map(
      (r) => `${r.bookNo}:${r.chapter}:${r.verseStart}`,
    )

  it('carries the book through a bracket, which a note would not', () => {
    // 可四31's cross-reference. The bracketed 十七20 is Matthew 17:20; read as
    // a note it became chapter 17 of Mark, which has sixteen.
    const text = '31～32：太十三31～32（十七20），路十三18～19'
    expect(at(text, 'list')).toEqual(['41:4:31', '40:13:31', '40:17:20', '42:13:18'])
    expect(at(text, 'note')).toEqual(['41:4:31', '40:13:31', '41:17:20', '42:13:18'])
  })

  it('reads a bracketed gloss the same either way', () => {
    // 彼後二12's cross-reference, where the bracket explains a word. Nothing in
    // it is a citation, so it is not a boundary in either mode.
    const text = '路一68，78（臨到，原文，眷顧），十九44，徒十五14'
    expect(at(text, 'list')).toContain('42:19:44')
    expect(at(text, 'note')).toContain('42:19:44')
  })
})

describe('what ends a context', () => {
  const at = (t: string, book = 62, chapter = 1) =>
    parseRefs(t, { book, chapter }).refs.map((r) => `${r.bookNo}:${r.chapter}:${r.verseStart}`)

  it('ends it at a bracket that holds a citation', () => {
    // In a note the bracket is its own citation and the text resumes belonging
    // to the verse being annotated — so inside 「（十七20）」 the book is Mark's,
    // the one the note hangs on. (A cross-reference reads the same line the
    // other way; see kind: 'list' above.)
    expect(at('太十三31～32（十七20），5', 41, 4)).toEqual(['40:13:31', '41:17:20', '41:4:5'])
  })

  it('leaves it alone at a bracket that holds a gloss', () => {
    // 約壹一6註5. 「（二次）」 is not a citation, so 7 is still in chapter three.
    expect(at('這辭也用在二17、29，三4（二次）、7')).toEqual(['62:2:17', '62:2:29', '62:3:4', '62:3:7'])
  })

  it('brings 「本篇」/「本章」 home, and what follows with them', () => {
    // 來八6註4: 本章 returns to Hebrews, so 十16～17 is Hebrews too.
    expect(at('在耶三一31～34所賜，而在本章8～12節和十16～17所引用的', 58, 8)).toEqual([
      '24:31:31',
      '58:8:8',
      '58:10:16',
    ])
  })

  it('reads a bare 「N節」 as the annotated chapter', () => {
    // 詩一○二1註1: the psalm is what Hebrews quotes, not Hebrews itself.
    expect(at('這由來一10～12引用25～27節所指明', 19, 102)).toEqual(['58:1:10', '19:102:25'])
  })

  it('keeps a bare 「N節」 with the citation a conjunction ties it to', () => {
    // 路十三6註2: 「十一29～32和42～52節」 is one place in two halves.
    expect(at('十一29～32和42～52節這兩段話', 42, 13)).toEqual(['42:11:29', '42:11:42'])
  })
})

describe('約參', () => {
  it('reads the epistle either way its number is written', () => {
    // 約貳一12's cross-reference is 「約參14」. The canon spells it 約叁.
    for (const t of ['約參14', '約叁14']) {
      expect(parseRefs(t, { book: 63, chapter: 1 }).refs).toEqual([
        expect.objectContaining({ bookNo: 64, chapter: 1, verseStart: 14 }),
      ])
    }
  })
})

describe('context seeds', () => {
  it('reads the two passages that name no book the way they mean it', () => {
    const at = (t: string, b: number, c: number) =>
      parseRefs(t, { book: b, chapter: c }).refs.map((r) => `${r.bookNo}:${r.chapter}:${r.verseStart}`)
    // 可十四20註1 — the supper is Luke 22:19-20, not Mark 14:19-20.
    expect(at('因主的晚餐是在前面19～20節題起的。', 41, 14)).toEqual(['42:22:19'])
    // 路十一49註1 — 「所差來的」 answers 2 Chr 24:19.
    expect(at('而擴大前文19節的話，用於神', 42, 11)).toEqual(['14:24:19'])
  })

  it('says where each phrase is and carries the number it is there for', () => {
    // That a phrase occurs exactly once is checked against the 29,919 notes,
    // not here — this file may not read the corpus, since the app's types stop
    // at the browser. Verified 2026-08-05; see scripts/PARSE_EXCEPTIONS.md.
    // What is worth asserting here is the shape: an exception with no reason
    // written down is one nobody can retire.
    for (const seed of CONTEXT_SEEDS) {
      expect(seed.find).toMatch(/[0-9]/)
      expect(seed.why.length).toBeGreaterThan(10)
    }
    expect(new Set(CONTEXT_SEEDS.map((s) => s.find)).size).toBe(CONTEXT_SEEDS.length)
  })
})
