import { describe, expect, it } from 'vitest'
import { parseStudyLines } from './studyParse'
import type { VerseRef } from './parseToken'

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

const refSigs = (refs: VerseRef[]) => refs.map(sig)

describe('parseStudyLines — line kinds', () => {
  it('empty line', () => {
    expect(parseStudyLines('')).toEqual([{ kind: 'empty' }])
  })

  it('week heading (bracketed legacy form)', () => {
    expect(parseStudyLines('【週一】')).toEqual([{ kind: 'week' }])
  })

  it('week heading (spaced new-style form)', () => {
    expect(parseStudyLines('週　一')).toEqual([{ kind: 'week' }])
  })

  it('reading line carries the original text + parsed refs', () => {
    const lines = parseStudyLines('讀經：太一1，二5')
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe('reading')
    if (lines[0].kind !== 'reading') throw new Error('typecheck')
    expect(lines[0].text).toBe('讀經：太一1，二5')
    expect(refSigs(lines[0].refs)).toEqual(['40:1:1', '40:2:5'])
  })

  it('title lines render before the 讀經 line', () => {
    const lines = parseStudyLines(['第一週', '基督是身體', '讀經：太一1'].join('\n'))
    expect(lines[0]).toEqual({ kind: 'title', text: '第一週' })
    expect(lines[1]).toEqual({ kind: 'title', text: '基督是身體' })
    expect(lines[2].kind).toBe('reading')
  })
})

describe('parseStudyLines — point markers + levels', () => {
  it('壹 marker → level 1', () => {
    const [p] = parseStudyLines('壹、本週的綱要')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(1)
    expect(p.marker).toBe('壹')
  })

  it('一 marker → level 2', () => {
    const [p] = parseStudyLines('一、第一點')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(2)
    expect(p.marker).toBe('一')
  })

  it('arabic marker → level 3', () => {
    const [p] = parseStudyLines('1. 第三層')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(3)
    expect(p.marker).toBe('1')
  })

  it('alpha marker → level 4', () => {
    const [p] = parseStudyLines('A. 第四層')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(p.level).toBe(4)
    expect(p.marker).toBe('A')
  })
})

describe('parseStudyLines — ref regions in point lines', () => {
  it('refs after a dash are picked up', () => {
    const [p] = parseStudyLines('壹、神人生活—太一1，二5')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['40:1:1', '40:2:5'])
  })

  it('refs inside (…) are picked up', () => {
    const [p] = parseStudyLines('壹、神人生活（太一1）')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['40:1:1'])
  })

  it('full book name in prose seeds ctx for a chapterless trailing ref', () => {
    // 「叁　羅馬書...— 一17」: parseToken on 「一17」 needs a book — the
    // 羅馬書 in prose seeds ctx so the ref binds correctly to Romans.
    const [p] = parseStudyLines('叁、羅馬書的盼望—一17')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['45:1:17'])
  })

  it('啓 normalises to 啟 in outline copy-paste', () => {
    const [p] = parseStudyLines('壹、得勝—啓二一23')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:21:23'])
  })

  it('full-width （ ） normalise to half-width', () => {
    const [p] = parseStudyLines('壹、得勝（啟二一23）')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:21:23'])
  })
})

describe('parseStudyLines — 與(?![注註]) splitter', () => {
  it('「詩四八2與註1」 stays together so 與註1 attaches as the note', () => {
    const [p] = parseStudyLines('叁、復興—詩四八2與註1，啟三12、21：')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual([
      '19:48:2與註1',
      '66:3:12',
      '66:3:21',
    ])
  })

  it('「詩四八2與五10」 splits — 與 between two refs still separates them', () => {
    const [p] = parseStudyLines('叁、合一—詩四八2與五10')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['19:48:2', '19:5:10'])
  })

  it('direct 「啟二一23註1」 in an outline parses as a direct-note ref', () => {
    const [p] = parseStudyLines('叁、新城—啟二一23註1')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:21:23註1'])
  })

  it('per-verse notes across a 、 list (啟二1注3、2注1)', () => {
    // Compose must match the lookup panel: 注3 on Rev 2:1, 注1 on Rev 2:2.
    const [p] = parseStudyLines('叁、x—啟二1注3、2注1')
    if (p.kind !== 'point') throw new Error('typecheck')
    expect(refSigs(p.refs)).toEqual(['66:2:1註3', '66:2:2註1'])
  })
})
