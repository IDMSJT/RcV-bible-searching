import { describe, expect, it } from 'vitest'
import { toTraditional } from './s2t'

describe('toTraditional', () => {
  it('converts a Simplified outline line, book names and references included', () => {
    expect(toTraditional('一 神的经纶（约一1，三16；创一1）')).toBe('一 神的經綸（約一1，三16；創一1）')
    expect(toTraditional('读经：加拉太书四章二节')).toBe('讀經：加拉太書四章二節')
  })

  it('picks the reading by context (发 → 發 / 髮)', () => {
    expect(toTraditional('他发现了真理')).toContain('發現')
    expect(toTraditional('头发和胡须')).toContain('頭髮')
  })

  it('uses the glyphs the Recovery Version uses', () => {
    expect(toTraditional('里面的生命经历')).toContain('裏面')
    expect(toTraditional('着重在经历')).toContain('著重')
  })

  it('leaves a line with only shared characters as written', () => {
    expect(toTraditional('里面的生命')).toBe('里面的生命')
  })

  it('leaves Traditional lines untouched, even with characters Simplified shares', () => {
    const t = '皇后來到公里外，干犯了律法'
    expect(toTraditional(t)).toBe(t)
  })

  it('converts only the Simplified lines of a mixed paste', () => {
    expect(toTraditional('神的經綸\n约翰福音三章')).toBe('神的經綸\n約翰福音三章')
  })

  it('returns the very same string when nothing is Simplified', () => {
    const t = '約翰福音三16'
    expect(toTraditional(t)).toBe(t)
    expect(toTraditional('')).toBe('')
  })
})
