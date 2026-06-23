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
  if (r.note != null) v += r.noteDirect ? `註${r.note}` : `與註${r.note}`
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
})
