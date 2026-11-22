/** One conversion table, as scripts/build_s2t.py writes it: `c` is character pairs
 * (from, to, from, to …), `p` phrases (`from\tto` joined by `|`). */
export interface ConvTable {
  c: string
  p: string
}

/** A converter from a table: the longest phrase at each position, else the
 * character's own mapping, else the character itself. Walks code points, so
 * characters outside the BMP (𠮷) count as one. */
export function makeConverter({ c, p }: ConvTable): (text: string) => string {
  const chars = new Map<string, string>()
  const cc = Array.from(c)
  for (let i = 0; i + 1 < cc.length; i += 2) chars.set(cc[i], cc[i + 1])
  const phrases = new Map<string, string>()
  const maxLen = new Map<string, number>() // first char → longest phrase, in code points
  for (const e of p.split('|')) {
    const [k, v] = e.split('\t')
    if (!k || v == null) continue
    const ka = Array.from(k)
    phrases.set(k, v)
    maxLen.set(ka[0], Math.max(maxLen.get(ka[0]) ?? 0, ka.length))
  }
  return (text) => {
    const a = Array.from(text)
    let out = ''
    for (let i = 0; i < a.length; ) {
      let hit = 0
      for (let len = Math.min(maxLen.get(a[i]) ?? 0, a.length - i); len >= 2; len--) {
        const v = phrases.get(a.slice(i, i + len).join(''))
        if (v != null) {
          out += v
          hit = len
          break
        }
      }
      if (hit) i += hit
      else {
        out += chars.get(a[i]) ?? a[i]
        i++
      }
    }
    return out
  }
}
