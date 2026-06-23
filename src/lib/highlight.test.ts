import { describe, expect, it } from 'vitest'
import { carryHlForChapter, parseHighlight, type HlItem } from './highlight'

describe('parseHighlight', () => {
  it('empty / undefined → no items', () => {
    expect(parseHighlight(undefined)).toEqual([])
    expect(parseHighlight('')).toEqual([])
  })

  it('single verse', () => {
    expect(parseHighlight('5')).toEqual<HlItem[]>([{ kind: 'verse', start: 5, end: 5 }])
  })

  it('verse range', () => {
    expect(parseHighlight('13-15')).toEqual<HlItem[]>([{ kind: 'verse', start: 13, end: 15 }])
  })

  it('note ref', () => {
    expect(parseHighlight('13:1')).toEqual<HlItem[]>([{ kind: 'note', verse: 13, n: 1 }])
  })

  it('cross-chapter range', () => {
    expect(parseHighlight('11:27-12:37')).toEqual<HlItem[]>([
      { kind: 'crange', startCh: 11, startV: 27, endCh: 12, endV: 37 },
    ])
  })

  it('cross-chapter range is NOT mis-parsed as a note', () => {
    // 「11:27」 alone is a note; with 「-12:37」 it must be a crange, not a
    // note followed by garbage.
    const items = parseHighlight('11:27-12:37')
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('crange')
  })

  it('mixed list keeps order and kinds', () => {
    expect(parseHighlight('3,13-15,13:1,11:27-12:37')).toEqual<HlItem[]>([
      { kind: 'verse', start: 3, end: 3 },
      { kind: 'verse', start: 13, end: 15 },
      { kind: 'note', verse: 13, n: 1 },
      { kind: 'crange', startCh: 11, startV: 27, endCh: 12, endV: 37 },
    ])
  })

  it('whitespace around items is tolerated', () => {
    expect(parseHighlight(' 3 , 13:1 ')).toEqual<HlItem[]>([
      { kind: 'verse', start: 3, end: 3 },
      { kind: 'note', verse: 13, n: 1 },
    ])
  })

  it('garbage items are dropped', () => {
    expect(parseHighlight('abc,5,!!')).toEqual<HlItem[]>([{ kind: 'verse', start: 5, end: 5 }])
  })
})

describe('carryHlForChapter', () => {
  const cr = parseHighlight('11:27-12:37') // crange 11..12

  it('carries the crange into a chapter it covers', () => {
    expect(carryHlForChapter(cr, 11)).toBe('11:27-12:37')
    expect(carryHlForChapter(cr, 12)).toBe('11:27-12:37')
  })

  it('clears (undefined) for chapters outside the range', () => {
    expect(carryHlForChapter(cr, 10)).toBeUndefined()
    expect(carryHlForChapter(cr, 13)).toBeUndefined()
  })

  it('drops plain verse / note items — only cranges carry', () => {
    const items = parseHighlight('5,13:1,11:27-12:37')
    // verse 5 and note 13:1 are chapter-scoped and must NOT bleed into ch12.
    expect(carryHlForChapter(items, 12)).toBe('11:27-12:37')
  })

  it('no crange → undefined', () => {
    expect(carryHlForChapter(parseHighlight('5,13:1'), 6)).toBeUndefined()
  })
})
