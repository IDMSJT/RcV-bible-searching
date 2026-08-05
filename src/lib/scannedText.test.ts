import { describe, expect, it } from 'vitest'
import { parseRefs } from './parseRefs'
import { citationsOnly, tidyScanned } from './scannedText'

describe('tidyScanned', () => {
  it('leaves a single line alone, spaces and all', () => {
    // The keyword search separates its words with spaces.
    expect(tidyScanned('創一 2')).toBe('創一 2')
  })

  it('closes a space that fell inside a reference', () => {
    const t = tidyScanned('一 得救—羅十 13。\n二 從急難')
    expect(t).toContain('羅十13')
    expect(parseRefs(t).refs).toContainEqual(
      expect.objectContaining({ bookNo: 45, chapter: 10, verseStart: 13 }),
    )
  })

  it('joins a line that stopped in the middle of a range', () => {
    // 03.jpg's reading line: the printed line ran out after the range mark.
    const t = tidyScanned('讀經：啟一17～18，徒二24，腓三10～\n11\n啟1:17 我一看見')
    expect(parseRefs(t).refs).toContainEqual(
      expect.objectContaining({ bookNo: 50, chapter: 3, verseStart: 10, verseEnd: 11 }),
    )
  })

  it('keeps a line that ended on a sentence', () => {
    const t = tidyScanned('得救—羅十13。\n二 從急難、患難')
    expect(t).toContain('。\n二')
  })
})

describe('citationsOnly', () => {
  const page = [
    '石上，陰周 第四篇',
    '獅子羔羊',
    '去，受長老 讀經：啓五5~10',
    '事绝不合国司 啓5:5 長老中有一位對我說，不要哭',
    '跌我的·  啓5:6 我又看見寶座與四活物中間',
    '起他的十1    的，有七角和七眼',
    '啓5:7 這羔羊前來',
    '壹 啟示錄這卷書是耶穌基督的一幅圖畫；',
  ].join('\n')

  it('keeps the reading line and drops what it already covers', () => {
    // 啓5:5、5:6、5:7 are printed below as verse labels; the line above reaches
    // all three. 「十1」 is prose the recogniser turned into a number.
    expect(citationsOnly(page)).toBe('啓五5~10')
  })

  it('recognises a book name written with either variant', () => {
    // The page says 啓; the canon says 啟. A segment keeps the page's spelling.
    expect(citationsOnly('啓五5~10\n啓5:5 長老中有一位')).toBe('啓五5~10')
    expect(citationsOnly('啟五5～10\n啟5:5 長老中有一位')).toBe('啟五5～10')
  })

  it('keeps a bare citation inside the list it belongs to', () => {
    // 02.jpg's reading line: 5, 9~12 and 七9~17 each borrow the book before it.
    expect(citationsOnly('讀經：啟一1～2，5，9～12，七9～17，十九10\n啟1:1 耶穌基督的啟示')).toBe(
      '啟一1～2，5，9～12，七9～17，十九10',
    )
  })

  it('drops a bare number that stands on its own in the prose', () => {
    expect(citationsOnly('讀經：啟十四1～5\n得勝的十四萬四千人，14，站在錫安山')).toBe('啟十四1～5')
  })

  it('keeps a later citation that points somewhere new', () => {
    expect(citationsOnly('讀經：羅十12～13\n一 得救—羅十13。\n二 蒙拯救—詩十八6。')).toBe(
      '羅十12～13，詩十八6',
    )
  })

  it('tells a note apart from the verse it hangs on', () => {
    expect(citationsOnly('讀經：徒二21\n三 就接受那靈—徒二21註2。')).toBe('徒二21，徒二21註2')
  })
})
