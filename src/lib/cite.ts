import { BOOK_ABBREV } from '@/data/abbrev'
import { BOOK_BY_NO } from '@/data/canon'
import { MID_FORM } from '@/data/bookAliases'
import { chapterNumeral, chapterUnit, toChineseNumber } from '@/lib/chinese'

/** Copy/share citation styles (the part before the 『經文』). */
export type CiteFormat = 'colon' | 'cn-ch' | 'full-cn'

export const CITE_FORMATS: { value: CiteFormat; example: string }[] = [
  { value: 'colon', example: '約3:16' },
  { value: 'cn-ch', example: '約三16' },
  { value: 'full-cn', example: '約翰三章十六節' },
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

/** Whether the ref label comes before or after the 『經文』 when copying. */
export type CitePosition = 'ref-first' | 'text-first'

export const CITE_POSITIONS: { value: CitePosition; label: string }[] = [
  { value: 'text-first', label: '經文在前' },
  { value: 'ref-first', label: '經文在後' },
]

export const DEFAULT_CITE_POSITION: CitePosition = 'ref-first'

/** Join a ref label and its already-quoted text into one line, ordered per
 * `pos`. `sep` sits between them — empty for the 『』 Chinese form, a space for
 * the English "…" form. */
export function formatCitation(
  label: string,
  quoted: string,
  pos: CitePosition,
  sep = '',
): string {
  return pos === 'text-first' ? `${quoted}${sep}${label}` : `${label}${sep}${quoted}`
}

/** Language to copy / share verses in. en / both only apply when 顯示英文 is on
 * (otherwise there's no English text to emit). */
export type CopyLang = 'zh' | 'en' | 'both'

export const COPY_LANGS: { value: CopyLang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'both', label: '中英文' },
]

export const DEFAULT_COPY_LANG: CopyLang = 'zh'
