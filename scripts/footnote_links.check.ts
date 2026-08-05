/**
 * The comparison half of check_footnote_links.py — run it, not this.
 *
 * Named `.check.ts` rather than `.test.ts` so `pnpm test` leaves it alone: it
 * needs a cache the Python side fetches, and it asserts nothing. Everything it
 * has to say it prints.
 */
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { BOOK_BY_NO } from '../src/data/canon'
import { parseRefs } from '../src/lib/parseRefs'
import { refsExist } from '../src/lib/lookupResults'
import type { AnnotationData, Bible } from '../src/types/bible'

type Cut = { key: string; n: number; at: number; len: number }

const read = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T
const nm = (n: number) => BOOK_BY_NO.get(n)?.name ?? String(n)
const show = (r: { bookNo: number; chapter: number; verseStart: number; verseEnd: number }) =>
  `${nm(r.bookNo)}${r.chapter}:${r.verseStart}${r.verseEnd !== r.verseStart ? `~${r.verseEnd}` : ''}`

it('footnote links', () => {
  const cuts = read<Cut[]>('scripts/output/footnote_cuts.json')
  const an = read<AnnotationData>('public/annotations.json')
  const bible = read<Bible>('public/verse.json')

  // Group the publisher's block starts by the note they fall in.
  const byNote = new Map<string, Cut[]>()
  for (const c of cuts) {
    const k = `${c.key}:${c.n}`
    byNote.set(k, [...(byNote.get(k) ?? []), c])
  }

  const out: string[] = []
  let notes = 0
  let refs = 0
  let badNow = 0
  let badCut = 0
  const moved: string[] = []
  const unresolved: string[] = []

  for (const [k, cs] of byNote) {
    const [b, c, seg] = k.split(':')[0].split('.').map(Number)
    const n = Number(k.split(':')[1])
    const note = an.notes[`${b}.${c}.${seg}`]?.find((x) => x.n === n)
    if (!note) continue
    notes++
    const ctx = { book: b, chapter: c }
    const where = `${nm(b)}${c}:${seg}註${n}`

    const now = parseRefs(note.text, ctx)
    const cut = parseRefs(note.text, ctx, { cuts: new Set(cs.map((x) => x.at)) })
    refs += now.refs.length
    badNow += refsExist(now.refs, bible).filter((x) => !x).length
    badCut += refsExist(cut.refs, bible).filter((x) => !x).length

    // Where each segment actually sits. indexOf finds the first occurrence,
    // which for a segment reading 「9」 is almost never the right one.
    const spanAt = new Map<number, [number, number]>()
    {
      let at = 0
      let refIdx = 0
      for (const s of now.segments) {
        if (s.refs?.length) spanAt.set(refIdx++, [at, at + s.text.length])
        at += s.text.length
      }
    }

    if (now.refs.length === cut.refs.length) {
      const okCut = refsExist(cut.refs, bible)
      const okNow = refsExist(now.refs, bible)
      now.refs.forEach((x, i) => {
        const y = cut.refs[i]
        if (x.bookNo === y.bookNo && x.chapter === y.chapter && x.verseStart === y.verseStart) return
        const seg2 = now.segments.filter((s) => s.refs?.length)[i]
        const at = spanAt.get(i)?.[0] ?? 0
        const verdict = okNow[i] && !okCut[i] ? ' ← 區塊版指向不存在的經節' : ''
        moved.push(
          `${where}「${seg2?.text}」 ${show(x)} → ${show(y)}${verdict}\n` +
            `    …${note.text.slice(Math.max(0, at - 30), at + (seg2?.text.length ?? 0) + 14)}…`,
        )
      })
    }

    // Blocks the publisher marks where we resolve nothing at all.
    for (const s of cs) {
      const span = note.text.slice(s.at, s.at + s.len)
      const hit = [...spanAt.values()].some(([a, z]) => a < s.at + s.len && z > s.at)
      if (!hit) unresolved.push(`${where}\t${span}`)
    }
  }

  out.push('══ 官方引經區塊 vs 我們的解析 ══')
  out.push(`註解 ${notes} 則，引經 ${refs} 筆`)
  out.push(`  現況        指向不存在的經節 ${badNow}`)
  out.push(`  以區塊為界  指向不存在的經節 ${badCut}`)
  out.push('')
  out.push(`── 兩者解得不同：${moved.length} 筆 ──`)
  out.push(...moved)
  out.push('')
  // Shape matters more than volume here: one recurring form is a rule, a
  // scattering of odd ones is a tail.
  const shape = (t: string) => {
    if (/^[0-9]+$/.test(t)) return '裸阿拉伯數字'
    if (/^[一二三四五六七八九十百○]+$/.test(t)) return '裸中文數字'
    if (/註/.test(t)) return '含「註」'
    if (/^[0-9一二三四五六七八九十百○]+[～~—-]/.test(t)) return '裸範圍'
    return '其他'
  }
  const kinds = new Map<string, string[]>()
  for (const u of unresolved) {
    const t = u.split('\t')[1]
    kinds.set(shape(t), [...(kinds.get(shape(t)) ?? []), u])
  }
  out.push(`── 官方標了、我們一筆也沒解出來：${unresolved.length} ──`)
  for (const [k, list] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`  ${k}：${list.length}`)
    for (const u of list.slice(0, 6)) out.push(`      ${u.replace('\t', '「')}」`)
    if (list.length > 6) out.push(`      …其餘 ${list.length - 6} 筆`)
  }
  out.push('')
  out.push('※ 區塊是編輯標的，不是標準答案 —— 已知它自己也錯至少兩處。')
  out.push('  兩邊不同的每一筆都要讀過原文才算數。理由見 scripts/PARSE_EXCEPTIONS.md。')
  console.log(out.join('\n'))
})
