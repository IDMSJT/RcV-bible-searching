import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { parseRefs, type VerseRef } from '@/lib/parseRefs'
import type { Annotation, Mark } from '@/types/bible'

// The `?hl=` value for one ref:
//   - cross-chapter range    → 「chA:vA-chB:vB」 (ChapterView clips per chapter)
//   - direct note (二1注3)   → 「verse:note」 (note-only, no verse tint)
//   - connected note (與註1) → 「verse,verse:note」 (verse tinted + note)
//   - no note                → the verse / verse-range
function hlForRef(ref: VerseRef): string {
  // A cross-chapter range can't carry a note (the 注N grammar only attaches to
  // a single verse), so this case is mutually exclusive with the note ones.
  if (ref.endChapter !== ref.chapter) {
    return `${ref.chapter}:${ref.verseStart}-${ref.endChapter}:${ref.verseEnd}`
  }
  const range =
    ref.verseStart === ref.verseEnd
      ? String(ref.verseStart)
      : `${ref.verseStart}-${ref.verseEnd}`
  if (ref.note == null) return range
  if (ref.noteDirect && ref.verseStart === ref.verseEnd) {
    return `${ref.verseStart}:${ref.note}`
  }
  return `${range},${ref.verseStart}:${ref.note}`
}

// 人名 / 地名 單底線、補字 點底線（音譯 tl 不標）；線用淡色
const MARK_CLASS: Record<string, string> = {
  pn: 'underline decoration-1 decoration-muted-foreground/60 underline-offset-4',
  png: 'underline decoration-1 decoration-muted-foreground/60 underline-offset-4',
  add: 'underline decoration-dotted decoration-1 decoration-muted-foreground/60 underline-offset-4',
}

/** Marks overlapping [start, end), re-based to that slice. */
export function sliceMarks(
  marks: Mark[] | undefined,
  start: number,
  end: number,
): Mark[] {
  if (!marks) return []
  const out: Mark[] = []
  for (const m of marks) {
    const s = Math.max(m.s, start)
    const e = Math.min(m.e, end)
    if (e > s) out.push({ k: m.k, s: s - start, e: e - start })
  }
  return out
}

/** Render verse text with two overlays:
 *   - semantic Marks (pn / png / add) as styled spans
 *   - footnote Annotations as clickable <sup> markers at given char offsets
 * Either may be empty / omitted — when both are, returns the bare string so
 * callers can short-circuit the ReactNode wrapper.
 */
export function renderMarkedText(
  text: string,
  marks?: Mark[],
  notes?: Annotation[],
  onNoteClick?: (n: number) => void,
): ReactNode {
  const ms = (marks ?? [])
    .filter((m) => MARK_CLASS[m.k] && m.e > m.s)
    .sort((a, b) => a.s - b.s)
  const sups = (notes ?? []).slice().sort((a, b) => a.offset - b.offset)
  if (ms.length === 0 && sups.length === 0) return text

  const out: ReactNode[] = []
  let pos = 0
  let keyCounter = 0
  let mIdx = 0
  let sIdx = 0

  const flushSupsAt = (p: number) => {
    while (sIdx < sups.length && sups[sIdx].offset === p) {
      const s = sups[sIdx++]
      out.push(
        <sup
          key={`s${keyCounter++}`}
          onClick={
            onNoteClick
              ? (e) => {
                  // Stop the surrounding row's click handler (e.g. lookup
                  // result rows that navigate on tap) from also firing.
                  e.stopPropagation()
                  onNoteClick(s.n)
                }
              : undefined
          }
          // Sits higher than the default <sup> baseline so it reads as a
          // distinct callout above the line. tabular-nums keeps 「1」/「10」
          // the same width so the verse glyphs don't jiggle as different
          // markers appear. p-1/-m-1 expands the clickable area without
          // shifting layout — the padding adds slop, the negative margin
          // pulls the surrounding glyphs back to where they would be.
          className="relative -top-[0.6em] -m-1 cursor-pointer p-1 text-[0.7em] font-sans font-medium tabular-nums text-destructive hover:text-destructive/80"
        >
          {s.n}
        </sup>,
      )
    }
  }

  while (pos < text.length) {
    flushSupsAt(pos)
    const m = ms[mIdx]
    if (m && m.s === pos) {
      if (m.e <= pos) {
        mIdx++
        continue
      }
      out.push(
        <span key={`m${keyCounter++}`} className={MARK_CLASS[m.k]}>
          {text.slice(m.s, m.e)}
        </span>,
      )
      pos = m.e
      mIdx++
      continue
    }
    const nextMarkStart = m ? m.s : text.length
    const nextSupOffset = sIdx < sups.length ? sups[sIdx].offset : text.length
    const boundary = Math.min(nextMarkStart, nextSupOffset)
    if (boundary > pos) {
      out.push(text.slice(pos, boundary))
      pos = boundary
    } else {
      pos += 1
    }
  }
  flushSupsAt(text.length)
  return <Fragment>{out}</Fragment>
}

/** Scan a note paragraph for refs and render them as clickable links. The
 * surrounding prose stays plain text. `initialCtx` seeds book/chapter so
 * 「十八20」 inside a Matt 1 note resolves to Matt 18:20 instead of dropping
 * for lack of a book.
 *
 * Each ref renders as a <Link> rather than a JS click handler so the
 * underlying <a href> is real — right-click / cmd-click / "copy link"
 * behave the same as any other anchor. */
export function renderNoteText(
  text: string,
  initialCtx: { book: number; chapter: number },
): ReactNode {
  const { segments } = parseRefs(text, initialCtx)
  if (segments.length === 0) return text

  return segments.map((seg, i) => {
    if (!seg.refs || seg.refs.length === 0) {
      return <Fragment key={i}>{seg.text}</Fragment>
    }
    // A segment can carry more than one ref — a footnote chain like
    // 「二1注3與注4」 yields one ref per note (all same book/chapter/verse).
    // Combine every ref's hl so the single link opens the destination chapter
    // with all of them tinted / expanded, instead of just the first note.
    const refs = seg.refs
    const ref = refs[0]
    const hl = refs.map(hlForRef).join(',')
    // Same-chapter jump (a note in ch.1 pointing at another verse in ch.1):
    // suppress the router's scroll-to-top so we glide straight from the
    // current verse to the target instead of bouncing off the top first.
    // Cross-chapter keeps the default reset — the content fully changes there.
    const sameChapter =
      ref.bookNo === initialCtx.book && ref.chapter === initialCtx.chapter
    return (
      <Link
        key={i}
        to="/$bookNo/$chapterNo"
        params={{ bookNo: ref.bookNo, chapterNo: ref.chapter }}
        search={{ hl }}
        resetScroll={sameChapter ? false : undefined}
        // The note body might be rendered inside a row whose surrounding
        // onClick navigates somewhere else (LookupPanel result rows). Stop
        // the click bubbling so the embedded ref's Link wins.
        onClick={(e) => e.stopPropagation()}
        className="text-primary hover:text-primary/80"
      >
        {seg.text}
      </Link>
    )
  })
}

/** Inline-expanded notes block for a single verse. Pass only the notes the
 * caller wants visible — typically the result of filtering against an
 * `expandedNotes` Set. `bookNo` / `chapterNo` seed the ref parser inside each
 * note paragraph so embedded refs resolve correctly. */
export function NoteList({
  notes,
  bookNo,
  chapterNo,
}: {
  notes: Annotation[]
  bookNo: number
  chapterNo: number
}): ReactNode {
  if (notes.length === 0) return null
  return (
    <ul className="mt-2 space-y-2 font-sans text-[0.95em] font-light leading-relaxed">
      {notes.map((n) => {
        // Split the note body on the restored paragraph breaks so we can
        // render each as its own <p> with space-y between — whitespace-pre-line
        // would collapse the inter-paragraph gap too tight.
        const paras = n.text.split('\n')
        return (
          <li
            key={n.n}
            className="space-y-2 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground"
          >
            {paras.map((para, i) => (
              <p key={i}>
                {i === 0 && (
                  <sup className="px-0.5 text-[0.7em] font-sans font-medium tabular-nums text-destructive">
                    {n.n}
                  </sup>
                )}
                {renderNoteText(para, { book: bookNo, chapter: chapterNo })}
              </p>
            ))}
          </li>
        )
      })}
    </ul>
  )
}
