import { BOOK_ABBREV } from '@/data/abbrev'
import { BOOK_BY_NO } from '@/data/canon'
import { MID_FORM } from '@/data/bookAliases'
import { chapterNumeral, chapterUnit, toChineseNumber } from '@/lib/chinese'

/** Copy/share citation styles (the part before the 『經文』). */
export type CiteFormat = 'colon' | 'cn-ch' | 'full-cn'

export const CITE_FORMATS: { value: CiteFormat; example: string }[] = [
  { value: 'colon', example: '太5:5' },
  { value: 'cn-ch', example: '太五5' },
  { value: 'full-cn', example: '馬太五章五節' },
]

export const DEFAULT_CITE_FORMAT: CiteFormat = 'colon'

/** Format one verse reference (book/chapter/verse) in the chosen style. */
export function formatVerseRef(
  bookNo: number,
  chapter: number,
  verse: number,
  fmt: CiteFormat,
): string {
  const abbrev = BOOK_ABBREV[bookNo] ?? ''
  if (fmt === 'cn-ch') return `${abbrev}${chapterNumeral(chapter)}${verse}`
  if (fmt === 'full-cn') {
    // Prefer the mid-form (馬太); fall back to the full name where there isn't
    // one (詩篇, the paired 撒上/撒下 … books).
    const name = MID_FORM[bookNo] ?? BOOK_BY_NO.get(bookNo)?.name ?? abbrev
    return `${name}${toChineseNumber(chapter)}${chapterUnit(bookNo)}${toChineseNumber(verse)}節`
  }
  return `${abbrev}${chapter}:${verse}` // 'colon' (default)
}
