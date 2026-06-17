const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

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
