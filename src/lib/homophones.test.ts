import { describe, expect, it } from 'vitest'
import { loadFold, soundMatches } from './homophones'

describe('sound fold', () => {
  it('folds characters that read alike to the same text', async () => {
    const fold = await loadFold()
    expect(fold('別士巴')).toBe(fold('別是巴'))
    expect(fold('別士巴')).not.toBe(fold('伯特利'))
  })

  it('keeps every character in place, and leaves non-Han text alone', async () => {
    const fold = await loadFold()
    const t = '在耶和華的山上必有豫備。John 3:16'
    expect(fold(t)).toHaveLength(t.length)
    expect(fold(t).endsWith('John 3:16')).toBe(true)
  })

  it('finds a misspelled word as the text writes it', async () => {
    const fold = await loadFold()
    const verse = '他給那井起名叫示巴，因此那城叫作別是巴，直到今日。'
    expect(soundMatches(verse, '別士巴', fold)).toEqual(['別是巴'])
    expect(soundMatches(verse, '伯特利', fold)).toEqual([])
  })
})
