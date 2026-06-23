import { describe, expect, it } from 'vitest'
import { parseToken, type ParseCtx, type VerseRef } from './parseToken'

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

function fresh(): ParseCtx {
  return { book: null, chapter: null }
}

function run(token: string, ctx?: ParseCtx) {
  const c = ctx ?? fresh()
  const r = parseToken(token, c)
  return { ok: r.ok, refs: r.refs.map(sig), ctx: c }
}

describe('parseToken — chapter forms', () => {
  it('CN-chapter + arabic-verse (compact 約一1)', () => {
    expect(run('約一1').refs).toEqual(['43:1:1'])
  })

  it('arabic + 章 + arabic + 節', () => {
    expect(run('太1章1節').refs).toEqual(['40:1:1'])
  })

  it('arabic + colon (太1:1)', () => {
    expect(run('太1:1').refs).toEqual(['40:1:1'])
  })

  it('fullwidth colon (太1：1)', () => {
    expect(run('太1：1').refs).toEqual(['40:1:1'])
  })

  it('Psalms 篇 marker', () => {
    expect(run('詩48篇2').refs).toEqual(['19:48:2'])
  })
})

describe('parseToken — single-chapter shorthand', () => {
  it('alias without CN chapter defaults to chapter 1 (猶24 = Jude 1:24)', () => {
    expect(run('猶24').refs).toEqual(['65:1:24'])
  })
})

describe('parseToken — verse list / range / segment', () => {
  it('comma list under one chapter', () => {
    expect(run('太一1、5、10').refs).toEqual([
      '40:1:1',
      '40:1:5',
      '40:1:10',
    ])
  })

  it('range with hyphen', () => {
    expect(run('太一1-3').refs).toEqual(['40:1:1-3'])
  })

  it('range with 至', () => {
    expect(run('太一1至3').refs).toEqual(['40:1:1-3'])
  })

  it('range with em-dash', () => {
    expect(run('太一1—3').refs).toEqual(['40:1:1-3'])
  })

  it('segment marker 上/下 on a single verse', () => {
    expect(run('太一1上').refs).toEqual(['40:1:1上'])
    expect(run('太一1下').refs).toEqual(['40:1:1下'])
  })

  it('cross-chapter range — endChapter advances', () => {
    expect(run('太一36～二5').refs).toEqual(['40:1-2:36-5'])
  })

  it('cross-chapter range followed by 、 verse — curChapter carries the new chapter', () => {
    // 太二9～三2、5 → 2:9–3:2, then 3:5 (NOT 2:5).
    expect(run('太二9～三2、5').refs).toEqual([
      '40:2-3:9-2',
      '40:3:5',
    ])
  })
})

describe('parseToken — 注N / 註N suffix', () => {
  it('direct attach (no connector)', () => {
    const r = run('太一21註3')
    expect(r.refs).toEqual(['40:1:21註3'])
  })

  it('connected via 與', () => {
    expect(run('太一21與註3').refs).toEqual(['40:1:21與註3'])
  })

  it('connected via whitespace', () => {
    expect(run('太一21 註3').refs).toEqual(['40:1:21與註3'])
  })

  it('attaches only to the LAST ref of a multi-verse token', () => {
    expect(run('太一21、22註3').refs).toEqual([
      '40:1:21',
      '40:1:22註3',
    ])
  })

  it('注 (simplified glyph) works the same as 註', () => {
    expect(run('太一21注3').refs).toEqual(['40:1:21註3'])
  })
})

describe('parseToken — context inheritance / mutation', () => {
  it('mutates ctx.book + ctx.chapter on success', () => {
    const ctx = fresh()
    parseToken('太一1', ctx)
    expect(ctx).toEqual({ book: 40, chapter: 1 })
  })

  it('cross-chapter range advances ctx.chapter to endChapter', () => {
    const ctx = fresh()
    parseToken('太一36～二5', ctx)
    expect(ctx).toEqual({ book: 40, chapter: 2 })
  })

  it('inherits ctx.book + ctx.chapter when token has no alias/chapter', () => {
    const ctx: ParseCtx = { book: 40, chapter: 1 }
    const r = parseToken('5', ctx)
    expect(r.refs.map(sig)).toEqual(['40:1:5'])
  })

  it('does NOT mutate ctx on failure', () => {
    const ctx: ParseCtx = { book: 40, chapter: 1 }
    const r = parseToken('非經文token', ctx)
    expect(r.ok).toBe(false)
    expect(ctx).toEqual({ book: 40, chapter: 1 })
  })

  it('book alias without trailing CN chapter resets ctx.chapter to 1', () => {
    // Bare 「猶」 with no chapter spec defaults to chapter 1 (single-chapter book).
    const ctx: ParseCtx = { book: 40, chapter: 5 }
    parseToken('猶24', ctx)
    expect(ctx).toEqual({ book: 65, chapter: 1 })
  })
})

describe('parseToken — defensive cases', () => {
  it('empty token fails', () => {
    expect(run('').ok).toBe(false)
  })

  it('「參」 prefix is stripped (參太一1 = 太一1)', () => {
    expect(run('參太一1').refs).toEqual(['40:1:1'])
  })

  it('missing book name fails when ctx has none', () => {
    expect(run('1:1').ok).toBe(false)
  })

  it('trailing 節 char is tolerated', () => {
    expect(run('太一1節').refs).toEqual(['40:1:1'])
  })
})
