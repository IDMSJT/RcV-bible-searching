import { describe, expect, it } from 'vitest'
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
