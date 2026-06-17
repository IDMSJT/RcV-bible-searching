import { CANON } from './canon'
import { BOOK_ABBREV } from './abbrev'

/**
 * Mid-form names (full name with the trailing 記/書/福音/… dropped), keyed by bookNo.
 * Only included for books where the mid-form is unambiguous. Paired books
 * (撒上/撒下, 林前/林後, …) and John's epistles are intentionally omitted —
 * use their full name or standard abbreviation (撒上, 約壹, …) instead, so that
 * compact forms like 約一1 stay unambiguous (= 約翰福音 1:1).
 */
const MID_FORM: Record<number, string> = {
  1: '創世', 2: '出埃及', 3: '利未', 4: '民數', 5: '申命',
  6: '約書亞', 7: '士師', 8: '路得',
  15: '以斯拉', 16: '尼希米', 17: '以斯帖', 18: '約伯',
  21: '傳道', 23: '以賽亞', 24: '耶利米', 26: '以西結', 27: '但以理',
  28: '何西阿', 29: '約珥', 30: '阿摩司', 31: '俄巴底亞', 32: '約拿',
  33: '彌迦', 34: '那鴻', 35: '哈巴谷', 36: '西番雅', 37: '哈該',
  38: '撒迦利亞', 39: '瑪拉基',
  40: '馬太', 41: '馬可', 42: '路加', 43: '約翰', 44: '使徒',
  45: '羅馬', 48: '加拉太', 49: '以弗所', 50: '腓立比', 51: '歌羅西',
  56: '提多', 57: '腓利門', 58: '希伯來', 59: '雅各', 65: '猶大',
}

/** Build alias → bookNo. On collision, the first assignment wins (longer/full names listed first). */
function buildAliasMap(): Map<string, number> {
  const map = new Map<string, number>()
  const add = (alias: string, bookNo: number) => {
    if (!map.has(alias)) map.set(alias, bookNo)
  }
  // Full names first (highest priority, unambiguous).
  for (const b of CANON) add(b.name, b.bookNo)
  // Standard abbreviations.
  for (const b of CANON) {
    const ab = BOOK_ABBREV[b.bookNo]
    if (ab) add(ab, b.bookNo)
  }
  // Mid-forms last (lowest priority).
  for (const [no, mid] of Object.entries(MID_FORM)) add(mid, Number(no))
  return map
}

export const BOOK_ALIASES = buildAliasMap()

/** Aliases sorted longest-first, for greedy prefix matching. */
export const BOOK_ALIAS_RE = new RegExp(
  '^(' +
    [...BOOK_ALIASES.keys()]
      .sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')',
)
