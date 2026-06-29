import { VARIANT_CLASS } from '@/data/variantClasses'

// Regex metacharacters to escape when a query char is dropped into a pattern
// literally. (Variant chars are all Han, never metacharacters, so the chars
// *inside* a [class] never need escaping.)
const META_RE = /[.*+?^${}()|[\]\\]/g

/** True when the token contains a character that has variant forms — the caller
 * can keep the fast `includes` path otherwise. */
export function hasVariant(token: string): boolean {
  for (const ch of token) if (VARIANT_CLASS[ch]) return true
  return false
}

/** Regex source for one token where each variant-bearing char becomes its whole
 * equivalence class (吃 → `[吃喫]`) and every other char is escaped literally.
 * Variant pairs are 1-char↔1-char, so a match keeps the token's length — match
 * offsets line up with the original text for highlighting. */
export function tokenPattern(token: string): string {
  let out = ''
  for (const ch of token) {
    const cls = VARIANT_CLASS[ch]
    out += cls ? `[${cls}]` : ch.replace(META_RE, '\\$&')
  }
  return out
}
