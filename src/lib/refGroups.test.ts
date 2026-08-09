import { describe, expect, it } from 'vitest'
import { parseRefs } from './parseRefs'
import { groupRefs, runOf } from './refGroups'

/** The text each group covers, plus the verses it names. */
function groups(text: string, ctx?: { book: number; chapter: number | null }) {
  const { segments } = parseRefs(text, ctx ?? { book: null, chapter: null })
  return groupRefs(segments).map((g) => ({
    text: segments
      .slice(g.from, g.to + 1)
      .map((s) => s.text)
      .join(''),
    refs: g.refs.map((r) => `${r.bookNo}:${r.chapter}:${r.verseStart}`),
  }))
}

describe('groupRefs', () => {
  it('joins verses of one chapter, punctuation and all', () => {
    expect(groups('賽十一1，2')).toEqual([
      { text: '賽十一1，2', refs: ['23:11:1', '23:11:2'] },
    ])
  })

  it('starts a new group at a new chapter', () => {
    expect(groups('撒上十六1，11～13，十七12')).toEqual([
      { text: '撒上十六1，11～13', refs: ['9:16:1', '9:16:11'] },
      { text: '十七12', refs: ['9:17:12'] },
    ])
  })

  it('starts a new group at a new book', () => {
    expect(groups('賽十一1，太一1')).toEqual([
      { text: '賽十一1', refs: ['23:11:1'] },
      { text: '太一1', refs: ['40:1:1'] },
    ])
  })

  it('is ended by a word, not only by punctuation', () => {
    // 「參」 is a thought of its own, so what follows is a separate citation even
    // though it lands in the same chapter.
    expect(groups('賽十一1，參2')).toEqual([
      { text: '賽十一1', refs: ['23:11:1'] },
      { text: '2', refs: ['23:11:2'] },
    ])
  })

  it('leaves a span that crosses a chapter on its own', () => {
    const g = groups('太一36～二5，二7')
    expect(g.map((x) => x.text)).toEqual(['太一36～二5', '二7'])
  })

  it('gives an ungrouped paragraph nothing', () => {
    expect(groups('這一節說到主的話')).toEqual([])
  })

  it('groups by where a citation landed, not how it was written', () => {
    // 「11」 names no chapter; it inherits Isaiah 11 and joins the group.
    const g = groups('見賽十一1，11', { book: 23, chapter: 1 })
    expect(g).toHaveLength(1)
    expect(g[0].refs).toEqual(['23:11:1', '23:11:11'])
  })
})

describe('runs', () => {
  const runs = (t: string) => {
    const { segments } = parseRefs(t, { book: 62, chapter: 1 })
    return groupRefs(segments).map((g) => g.run)
  }

  it('keeps a comma-separated list together across a chapter', () => {
    // Two places, written in one breath. Two groups so the change of chapter
    // still shows; one run so opening either opens both.
    expect(runs('撒上十六1，11～13，十七12')).toEqual([0, 0])
  })

  it('starts again where a word comes between', () => {
    expect(runs('賽十一1，參可一2')).toEqual([0, 1])
    expect(runs('太一1。可二3')).toEqual([0, 1])
  })

  it('hands back the whole run, and which of it was asked for', () => {
    const { segments } = parseRefs('撒上十六1，十七12', { book: 62, chapter: 1 })
    const groups = groupRefs(segments)
    const { refs, primary } = runOf(groups, 1)
    expect(refs.map((r) => `${r.chapter}:${r.verseStart}`)).toEqual(['16:1', '17:12'])
    expect([...primary].map((r) => `${r.chapter}:${r.verseStart}`)).toEqual(['17:12'])
  })
})
