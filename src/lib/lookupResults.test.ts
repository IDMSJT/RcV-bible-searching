import { describe, expect, it } from 'vitest'
import { parseRefs } from './parseRefs'
import { refsExist, resolveRefs, searchKeyword, type Sources } from './lookupResults'
import type { AnnotationData, Bible } from '@/types/bible'

// A pocket canon: two books, so a cross-chapter span and a missing verse can
// both be expressed without carrying the real 5 MB around.
const bible: Bible = {
  name: 'test',
  lang: 'zh',
  source: '',
  books: [
    {
      bookNo: 1,
      name: '創世記',
      chapters: [
        { chapterNo: 1, verses: [1, 2, 3].map((v) => ({ verse: v, text: `創一${v}` })) },
        { chapterNo: 2, verses: [1, 2].map((v) => ({ verse: v, text: `創二${v}` })) },
      ],
    },
    {
      bookNo: 40,
      name: '馬太福音',
      chapters: [{ chapterNo: 1, verses: [{ verse: 1, text: '太一1 吃餅' }] }],
    },
  ],
}
const bibleEn: Bible = {
  name: 'test-en',
  lang: 'en',
  source: '',
  books: [
    {
      bookNo: 1,
      name: 'Genesis',
      chapters: [{ chapterNo: 1, verses: [{ verse: 1, text: 'In the beginning' }] }],
    },
  ],
}
const annotations: AnnotationData = {
  source: '',
  notes: {
    '1.1.1': [
      { n: 1, offsets: [0], text: '註一' },
      { n: 2, offsets: [1], text: '註二' },
    ],
  },
}
const src: Sources = { bible, bibleEn, annotations, showEnglish: false }
const refs = (q: string) => parseRefs(q).refs
const rows = (q: string, s: Sources = src) =>
  resolveRefs(refs(q), s).map((r) => `${r.bookNo}:${r.chapterNo}:${r.verse.verse}${r.noteOnly ? `註${r.noteToShow?.n}` : ''}`)

describe('resolveRefs', () => {
  it('lists every verse of a range', () => {
    expect(rows('創一1～3')).toEqual(['1:1:1', '1:1:2', '1:1:3'])
  })

  it('walks a span across a chapter, each verse under its own chapter', () => {
    expect(rows('創一2～二1')).toEqual(['1:1:2', '1:1:3', '1:2:1'])
  })

  it('gives nothing for a verse the book does not have', () => {
    expect(rows('創一9')).toEqual([])
  })

  it('says which reference each row came from', () => {
    const out = resolveRefs(refs('創一1，二1'), src)
    expect(out.map((r) => r.refIndex)).toEqual([0, 1])
  })

  it('replaces the verse with the note a direct 註 asks for', () => {
    expect(rows('創一1註2')).toEqual(['1:1:1註2'])
  })

  it('keeps the verse when a connector joins the note to it', () => {
    expect(rows('創一1與註2')).toEqual(['1:1:1', '1:1:1註2'])
  })

  it('drops a direct 註 that names a note the verse has not got', () => {
    expect(rows('創一1註9')).toEqual([])
  })

  it('lists every note of a bare 註, the verse first when connected', () => {
    expect(rows('創一1註')).toEqual(['1:1:1註1', '1:1:1註2'])
    expect(rows('創一1與註')).toEqual(['1:1:1', '1:1:1註1', '1:1:1註2'])
  })

  it('carries the English only when asked for it', () => {
    const off = resolveRefs(refs('創一1'), src)
    expect(off[0].enText).toBeUndefined()
    const on = resolveRefs(refs('創一1'), { ...src, showEnglish: true })
    expect(on[0].enText).toBe('In the beginning')
  })

  it('has nothing to say before the text has loaded', () => {
    expect(resolveRefs(refs('創一1'), { ...src, bible: null })).toEqual([])
  })
})

describe('refsExist', () => {
  it('accepts a span whose end verse outruns its first chapter', () => {
    // 創一2～二1 is real even though chapter one stops at 3.
    expect(refsExist(refs('創一2～二1'), bible)).toEqual([true])
  })

  it('rejects a verse no chapter has', () => {
    expect(refsExist(refs('創一9'), bible)).toEqual([false])
  })

  it('assumes the best before the text has loaded', () => {
    expect(refsExist(refs('創一9'), null)).toEqual([true])
  })
})

describe('searchKeyword', () => {
  it('wants every word, in the Chinese or the English', () => {
    expect(searchKeyword('創一', src, 100).total).toBe(3)
    expect(searchKeyword('創一 2', src, 100).rows.map((r) => r.verse.verse)).toEqual([2])
  })

  it('matches a variant of the character typed', () => {
    // 喫 is written 吃 in this edition; searching either finds it.
    expect(searchKeyword('喫餅', src, 100).total).toBe(1)
  })

  it('searches the English too, ignoring case', () => {
    expect(searchKeyword('BEGINNING', { ...src, showEnglish: true }, 100).total).toBe(1)
    expect(searchKeyword('BEGINNING', src, 100).total).toBe(0)
  })

  it('counts every match but builds only as many rows as asked', () => {
    const { rows: r, total } = searchKeyword('創', src, 2)
    expect(total).toBe(5)
    expect(r).toHaveLength(2)
  })

  it('has nothing to say for an empty query', () => {
    expect(searchKeyword('   ', src, 100)).toEqual({ rows: [], total: 0 })
  })
})
