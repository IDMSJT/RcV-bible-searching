const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** Character class body for "1+ CN numeral" — without brackets so it can be
 * spliced into other regex sources. Includes both zero glyphs the source
 * uses for positional numbers: 〇 (U+3007) and ○ (U+25CB, a white circle the
 * RcV text often substitutes), e.g. 「一○三」 = 103. 廿 / 卅 are the contracted
 * twenty and thirty; rare, but 「約廿41」 was read as 「約」 alone and left its
 * verse numbers to be picked up by whatever had been cited before. */
export const CN_NUMERAL_CHARS = '零〇○一二三四五六七八九十百廿卅'
/** Pre-built "1+ CN numeral" char class, ready to plug into a regex. */
export const CN_NUMERAL_CLASS = `[${CN_NUMERAL_CHARS}]+`

const CN_POSITIONAL_DIGITS = '零一二三四五六七八九'

/** Convert 0-199 to traditional Chinese numerals (Bible-style: 一, 十, 十一, 二十, 一百一十九). */
export function toChineseNumber(n: number): string {
  if (n < 0 || n > 199 || !Number.isInteger(n)) return String(n)
  if (n < 10) return DIGITS[n]
  if (n < 20) return n === 10 ? '十' : '十' + DIGITS[n - 10]
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return DIGITS[tens] + '十' + (ones === 0 ? '' : DIGITS[ones])
  }
  const remainder = n - 100
  if (remainder === 0) return '一百'
  if (remainder < 10) return '一百零' + DIGITS[remainder]
  if (remainder < 20) return remainder === 10 ? '一百一十' : '一百一十' + DIGITS[remainder - 10]
  const tens = Math.floor(remainder / 10)
  const ones = remainder % 10
  return '一百' + DIGITS[tens] + '十' + (ones === 0 ? '' : DIGITS[ones])
}

/** Positional Chinese digits (compact ref labels): 21 → 二一, 119 → 一一九. */
export function toChineseDigits(n: number): string {
  return String(n)
    .split('')
    .map((d) => DIGITS[Number(d)])
    .join('')
}

/** Bible chapter unit — 詩篇用「篇」，其他用「章」. */
export function chapterUnit(bookNo: number): string {
  return bookNo === 19 ? '篇' : '章'
}

/** Display an outline marker with half-width parens — only L5 （四）/ L6 （1） have any. */
export function displayMarker(marker: string): string {
  return marker.replace(/（/g, '(').replace(/）/g, ')')
}

/**
 * Chapter numeral as used in Bible outline ranges: 11–19 keep 十 (十三), round
 * tens keep 十 (二十、五十), but 21–99 drop it (二五 = 25, 三七 = 37). 100+ falls
 * back to the spelled-out form (not reached for the 66-book canon).
 */
export function chapterNumeral(n: number): string {
  if (n < 20 || n >= 100) return toChineseNumber(n)
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return DIGITS[tens] + (ones === 0 ? '十' : DIGITS[ones])
}

const ENDPOINT_RE = /^(?:(\d+)[:：])?(\d+)([a-z])?$/

function formatEndpoint(s: string): string {
  const m = s.trim().match(ENDPOINT_RE)
  if (!m) return s.trim()
  const [, ch, verse, seg] = m
  const segCh = seg === 'a' ? '上' : seg === 'b' ? '下' : ''
  return (ch ? chapterNumeral(Number(ch)) : '') + verse + segCh
}

/**
 * Format an outline range for display: chapter→Chinese numeral, verse kept as
 * digits, the 上/下 切段 from a/b. e.g. "1:1～2:25" → "一1～二25", "1:2b～2:3" →
 * "一2下～二3". Composite ranges (，-separated) and within-chapter endpoints
 * (no chapter, e.g. "24～25") are preserved.
 */
export function formatOutlineRange(range: string): string {
  return range
    .split('，')
    .map((part) =>
      part
        .split(/[～~∼]/)
        .map(formatEndpoint)
        .join('～'),
    )
    .join('，')
}

const CN_TO_NUM = new Map<string, number>()
for (let i = 0; i <= 199; i++) CN_TO_NUM.set(toChineseNumber(i), i)

/** Parse a CN or arabic numeral string to a number. Supports standard CN
 * numerals (一/十/二十/一百一十九), the contracted 廿 / 卅, positional CN digits
 * (二三 = 23, 一一九 = 119), and pure arabic. Returns null when nothing matches. */
export function parseNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  // Normalise the circle-zero glyphs (〇 / ○) to 零 so positional parsing of
  // 「一○三」 = 103 works the same as 「一〇三」 / a spelled-out form.
  s = s.replace(/[〇○]/g, '零').replace(/廿/g, '二十').replace(/卅/g, '三十')
  const v = CN_TO_NUM.get(s)
  if (v != null) return v
  if (s.length > 0 && [...s].every((c) => CN_POSITIONAL_DIGITS.includes(c))) {
    return Number([...s].map((c) => CN_POSITIONAL_DIGITS.indexOf(c)).join(''))
  }
  return null
}
