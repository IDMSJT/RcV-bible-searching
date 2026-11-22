import table from '@/data/s2t.json'
import { makeConverter } from '@/lib/zhConv'

// Simplified → Traditional for what the reader types or pastes (綱要, search), so
// 简体 input finds its verses. The table is built from OpenCC and retargeted to our
// own text by scripts/build_s2t.py (see its header for why not a full converter);
// `g` is the set of characters that only exist in Simplified.
const convert = makeConverter(table)
const simplifiedOnly = new Set(Array.from(table.g))

/** Convert every line that is Simplified; leave the rest alone.
 *
 * A line counts as Simplified when it holds a character that Traditional text
 * never uses (创, 约, 经 …). Characters shared by both — 后, 里, 干 — can't tell
 * on their own, so a line that has only those is left as written: 皇后 and
 * 公里 are Traditional and converting them would break them. Line by line, so
 * a pasted outline that mixes the two still comes out right. */
export function toTraditional(text: string): string {
  let touched = false
  const out = text.split('\n').map((line) => {
    for (const ch of line) {
      if (simplifiedOnly.has(ch)) {
        touched = true
        return convert(line)
      }
    }
    return line
  })
  return touched ? out.join('\n') : text
}
