import type { Segment } from './parseRefs'
import type { VerseRef } from './parseToken'

/** Only punctuation between two citations — 「賽十一1，2」. A word between them
 * (「賽十一1，參可一2」) starts a new thought, so it ends the group. */
const SEPARATOR = /^[、，,；;和及與\s]*$/

/** Consecutive citations of one chapter, read as one. */
export interface RefGroup {
  /** First and last segment of the group, inclusive. What lies between is
   * punctuation, and belongs to the group so a tint over it runs unbroken. */
  from: number
  to: number
  /** Every verse the group names, in the order it names them. */
  refs: VerseRef[]
  /**
   * Which unbroken run of citations this belongs to.
   *
   * A group is a chapter; a run is everything the author wrote as one list.
   * 「撒上十六1，11～13，十七12」 is two groups and one run — two places, named
   * in one breath. Opening any of it opens all of it, because that is how it
   * was written; the tint stays per group so the change of chapter is still
   * visible, and the verse labels say which of them was asked for.
   */
  run: number
}

/** Whether a segment's citations all sit in one chapter of one book — a span
 * that crosses a chapter can't join a group, since the group is a chapter. */
function chapterOf(seg: Segment): { bookNo: number; chapter: number } | null {
  const refs = seg.refs
  if (!refs?.length) return null
  const { bookNo, chapter } = refs[0]
  const same = refs.every(
    (r) => r.bookNo === bookNo && r.chapter === chapter && r.endChapter === chapter,
  )
  return same ? { bookNo, chapter } : null
}

/**
 * Read a paragraph's citations as groups, one per chapter cited.
 *
 * 「賽十一1，2」 is one citation of Isaiah 11 that happens to name two verses, and
 * a reader opening it wants both. 「撒上十六1，11～13，十七12」 is two: the verses
 * of chapter sixteen, then chapter seventeen — a different chapter is a
 * different place, however close it is written. Across the cross-references and
 * footnotes this joins about a tenth of all citations, in runs of up to twelve.
 *
 * A citation that names no chapter of its own inherits one, so grouping reads
 * the parsed references rather than the text: what matters is where they landed,
 * not how they were written.
 *
 * Segments with no citation are not returned. A caller wanting to know which
 * group a segment belongs to can look for the one whose range contains it.
 */
export function groupRefs(segments: Segment[]): RefGroup[] {
  const groups: RefGroup[] = []
  let open: (RefGroup & { bookNo: number; chapter: number }) | null = null
  // A run carries on while only punctuation separates one citation from the
  // next. Anything else between them — a word, a bracket — is a new thought.
  let run = -1
  let lastEnd = -1
  const startRun = (from: number) => {
    const between = segments.slice(lastEnd + 1, from)
    if (lastEnd < 0 || !between.every((x) => SEPARATOR.test(x.text))) run++
    return run
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const here = chapterOf(seg)
    if (!here) {
      // A citation this can't group (a cross-chapter span) still ends the run.
      if (seg.refs?.length) {
        open = null
        groups.push({ from: i, to: i, refs: seg.refs, run: startRun(i) })
        lastEnd = i
      } else if (!SEPARATOR.test(seg.text)) {
        open = null
      }
      continue
    }
    if (open && open.bookNo === here.bookNo && open.chapter === here.chapter) {
      open.to = i
      open.refs.push(...seg.refs!)
    } else {
      open = { from: i, to: i, refs: [...seg.refs!], run: startRun(i), ...here }
      groups.push(open)
    }
    lastEnd = i
  }
  return groups
}

/** The group a segment belongs to, or -1. */
export function groupAt(groups: RefGroup[], i: number): number {
  return groups.findIndex((g) => i >= g.from && i <= g.to)
}

/**
 * Everything written alongside the group at `gi`, and which of it is that
 * group's own.
 *
 * Tapping any citation of a run opens the run; the labels then distinguish what
 * was asked for from what came with it. Computed rather than stored so the
 * caller only holds an index — the one thing it already has.
 */
export function runOf(
  groups: RefGroup[],
  gi: number,
): { refs: VerseRef[]; primary: ReadonlySet<VerseRef> } {
  const here = groups[gi]
  if (!here) return { refs: [], primary: new Set() }
  const refs = groups.filter((g) => g.run === here.run).flatMap((g) => g.refs)
  return { refs, primary: new Set(here.refs) }
}
