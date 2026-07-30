import { Fragment, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { parseRefs, type VerseRef } from '@/lib/parseRefs'
import { useBible, eachVerseInRange } from '@/data/loadBible'
import { formatVerseRef } from '@/lib/cite'
import { cn } from '@/lib/utils'
import type { Annotation, CrossRef, Mark } from '@/types/bible'

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
  // Bare 註 (noteAll). Single verse → 「v:*」 (all notes; connected also tints
  // the verse). Range → tint the span AND expand every verse's notes, so
  // 「可一40～45註」 opens all the footnotes across 40–45, not just highlights.
  if (ref.noteAll) {
    if (ref.verseStart === ref.verseEnd) {
      return ref.noteDirect ? `${ref.verseStart}:*` : `${ref.verseStart},${ref.verseStart}:*`
    }
    const parts = [`${ref.verseStart}-${ref.verseEnd}`]
    for (let v = ref.verseStart; v <= ref.verseEnd; v++) parts.push(`${v}:*`)
    return parts.join(',')
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

// Superscript markers sitting in the verse text — footnote numbers and
// cross-reference letters share one look (the digit/letter already tells them
// apart, like the printed edition). Sits higher than the default <sup> baseline
// so it reads as a distinct callout above the line. tabular-nums keeps 「1」/「10」
// the same width so the verse glyphs don't jiggle as different markers appear.
// p-1/-m-1 expands the clickable area without shifting layout — the padding
// adds slop, the negative margin pulls the surrounding glyphs back to where
// they would be. select-none: the marker is metadata — a text selection drags
// straight across it instead of catching on it or copying it.
/** Most verses a ref preview will show before it summarises the rest. */
const PREVIEW_MAX = 12

const SUP_CLS =
  'relative -top-[0.6em] -m-1 cursor-pointer p-1 text-[0.7em] font-sans font-medium tabular-nums text-destructive select-none hover:text-destructive/80'

/** Render verse text with three overlays:
 *   - semantic Marks (pn / png / add) as styled spans
 *   - footnote Annotations as clickable <sup> numbers at given char offsets
 *   - cross-references (串珠) as clickable <sup> letters
 * Any may be empty / omitted — when all are, returns the bare string so callers
 * can short-circuit the ReactNode wrapper.
 */
export function renderMarkedText(
  text: string,
  marks?: Mark[],
  notes?: Annotation[],
  onNoteClick?: (n: number) => void,
  crossRefs?: CrossRef[],
  onRefClick?: (m: string) => void,
): ReactNode {
  const ms = (marks ?? [])
    .filter((m) => MARK_CLASS[m.k] && m.e > m.s)
    .sort((a, b) => a.s - b.s)
  // One note can be anchored at several places in the verse, so each offset
  // becomes its own marker (all carrying the same note number). Cross-refs join
  // the same stream so both kinds interleave in text order at each position.
  const sups: { kind: 'note' | 'ref'; label: string | number; id: string; offset: number }[] = [
    ...(notes ?? []).flatMap((a) =>
      a.offsets.map((offset) => ({
        kind: 'note' as const,
        label: a.n,
        id: String(a.n),
        offset,
      })),
    ),
    ...(crossRefs ?? []).map((r) => ({
      kind: 'ref' as const,
      label: r.m,
      id: r.m,
      offset: r.offset,
    })),
    // Same offset → the footnote number comes first, then the cross-ref letter.
  ].sort((a, b) => a.offset - b.offset || (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1))
  if (ms.length === 0 && sups.length === 0) return text

  const out: ReactNode[] = []
  let pos = 0
  let keyCounter = 0
  let mIdx = 0
  let sIdx = 0

  const flushSupsAt = (p: number) => {
    while (sIdx < sups.length && sups[sIdx].offset === p) {
      const s = sups[sIdx++]
      const handler = s.kind === 'note' ? onNoteClick : onRefClick
      out.push(
        <sup
          key={`s${keyCounter++}`}
          onClick={
            handler
              ? (e) => {
                  // Stop the surrounding row's click handler (e.g. lookup
                  // result rows that navigate on tap) from also firing.
                  e.stopPropagation()
                  ;(handler as (v: string | number) => void)(
                    s.kind === 'note' ? Number(s.id) : s.id,
                  )
                }
              : undefined
          }
          className={SUP_CLS}
        >
          {s.label}
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
 * note paragraph so embedded refs resolve correctly. `highlightedNs` are the
 * note numbers the URL pointed at (?hl=v:n / v:*) — they get a warm tint so
 * the one the user navigated to stands out from notes they expanded by hand. */
/** The verses a ref points at, shown inline at the foot of a note / cross-ref
 * card. Reading a reference is usually about "what does that verse say" rather
 * than "take me there", so the text comes to the reader instead. The citation
 * label stays a real link for when they do want the chapter. */
function VersePreview({
  refs,
  ctx,
}: {
  refs: VerseRef[]
  ctx: { book: number; chapter: number }
}): ReactNode {
  const { data: bible } = useBible()
  if (!bible) return null

  const rows: { bookNo: number; chapterNo: number; verse: number; text: string }[] = []
  for (const ref of refs) {
    for (const { chapterNo, verse } of eachVerseInRange(
      bible,
      ref.bookNo,
      ref.chapter,
      ref.endChapter,
      ref.verseStart,
      ref.verseEnd,
    )) {
      rows.push({ bookNo: ref.bookNo, chapterNo, verse: verse.verse, text: verse.text })
    }
  }
  if (rows.length === 0) return null
  // A ref can span a lot of verses (詩一百十九…); show a workable slice rather
  // than burying the note under the whole passage.
  const shown = rows.slice(0, PREVIEW_MAX)
  const ref0 = refs[0]
  const sameChapter = ref0.bookNo === ctx.book && ref0.chapter === ctx.chapter

  return (
    // Same two-column shape as the search results: a narrow citation column
    // whose labels line up, verse text flowing in the rest.
    <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-t border-border/60 pt-2 font-serif text-foreground">
      {shown.map((r, i) => (
        <Fragment key={i}>
          <Link
            to="/$bookNo/$chapterNo"
            params={{ bookNo: r.bookNo, chapterNo: r.chapterNo }}
            search={{ hl: String(r.verse) }}
            resetScroll={sameChapter ? false : undefined}
            onClick={(e) => e.stopPropagation()}
            className="self-start whitespace-nowrap pt-1 text-left text-xs font-sans text-primary transition-colors hover:text-primary/80"
          >
            {formatVerseRef(r.bookNo, r.chapterNo, r.verse, 'colon')}
          </Link>
          <p>{r.text}</p>
        </Fragment>
      ))}
      {rows.length > shown.length && (
        <p className="col-span-2 font-sans text-[0.85em] text-muted-foreground">
          …共 {rows.length} 節
        </p>
      )}
    </div>
  )
}

/** Card body shared by notes and cross-refs: the prose, with every embedded ref
 * tappable. Tapping a ref reveals its verses at the foot of the card; tapping
 * another switches to it, and tapping the same one again closes it. */
function RefBody({
  paragraphs,
  bookNo,
  chapterNo,
  marker,
}: {
  paragraphs: string[]
  bookNo: number
  chapterNo: number
  /** Rendered before the first paragraph — the note number / cross-ref letter. */
  marker?: ReactNode
}): ReactNode {
  const [active, setActive] = useState<{ key: string; refs: VerseRef[] } | null>(null)
  const ctx = { book: bookNo, chapter: chapterNo }

  return (
    <>
      {paragraphs.map((para, pi) => {
        const { segments } = parseRefs(para, ctx)
        return (
          <p key={pi}>
            {pi === 0 && marker}
            {segments.length === 0
              ? para
              : segments.map((seg, si) => {
                  if (!seg.refs || seg.refs.length === 0) {
                    return <Fragment key={si}>{seg.text}</Fragment>
                  }
                  const key = `${pi}:${si}`
                  const on = active?.key === key
                  return (
                    <span
                      key={si}
                      role="button"
                      tabIndex={0}
                      // The card itself may select the note on tap (and lookup
                      // rows navigate) — keep both off this ref.
                      onPointerDown={(e) => e.stopPropagation()}
                      // Mouse users just sweep across the refs to read them;
                      // gated on pointerType so a touch's synthetic hover
                      // doesn't fire ahead of the tap on mobile.
                      onPointerEnter={(e) => {
                        if (e.pointerType === 'mouse') setActive({ key, refs: seg.refs! })
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActive(on ? null : { key, refs: seg.refs! })
                      }}
                      className={cn(
                        'cursor-pointer rounded text-primary hover:text-primary/80',
                        on && 'bg-primary/15',
                      )}
                    >
                      {seg.text}
                    </span>
                  )
                })}
          </p>
        )
      })}
      {active && <VersePreview refs={active.refs} ctx={ctx} />}
    </>
  )
}

/** The cross-references (串珠) opened on a verse — same card treatment as the
 * footnotes above, with the marker letter leading the line and each citation
 * tappable to peek at the verses it points to. */
export function CrossRefList({
  refs,
  bookNo,
  chapterNo,
}: {
  refs: CrossRef[]
  bookNo: number
  chapterNo: number
}): ReactNode {
  if (refs.length === 0) return null
  return (
    <ul className="mt-2 space-y-2 font-sans text-[0.95em] font-light leading-relaxed">
      {refs.map((r) => (
        <li key={r.m} className="space-y-2 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
          <RefBody
            paragraphs={[r.refs]}
            bookNo={bookNo}
            chapterNo={chapterNo}
            marker={
              <sup className="px-0.5 text-[0.7em] font-sans font-medium tabular-nums text-destructive">
                {r.m}
              </sup>
            }
          />
        </li>
      ))}
    </ul>
  )
}

export function NoteList({
  notes,
  verse,
  bookNo,
  chapterNo,
  highlightedNs,
  selectedNs,
  onSelectNote,
}: {
  notes: Annotation[]
  /** The verse these notes hang off — tags each card so a native copy can cite
   * it as 「太一1註2」. Omitted where notes render outside a chapter (lookup). */
  verse?: number
  bookNo: number
  chapterNo: number
  highlightedNs?: Set<number>
  /** Note numbers currently selected (for copy/share) — tinted blue. */
  selectedNs?: Set<number>
  /** Tap a note to toggle its selection. When set, notes become tappable and
   * embedded ref links still win via their own stopPropagation. */
  onSelectNote?: (n: number) => void
}): ReactNode {
  if (notes.length === 0) return null
  return (
    <ul className="mt-2 space-y-2 font-sans text-[0.95em] font-light leading-relaxed">
      {notes.map((n) => {
        // Split the note body on the restored paragraph breaks so we can
        // render each as its own <p> with space-y between — whitespace-pre-line
        // would collapse the inter-paragraph gap too tight.
        const paras = n.text.split('\n')
        const hit = highlightedNs?.has(n.n)
        const sel = selectedNs?.has(n.n)
        return (
          <li
            key={n.n}
            data-note={verse != null ? `${verse}:${n.n}` : undefined}
            // stopPropagation on pointerdown keeps the surrounding verse's
            // long-press from firing; onClick selects the note (ref links inside
            // stop their own propagation, so they still navigate).
            onPointerDown={onSelectNote ? (e) => e.stopPropagation() : undefined}
            onClick={
              onSelectNote
                ? (e) => {
                    e.stopPropagation()
                    onSelectNote(n.n)
                  }
                : undefined
            }
            // No select-none: the body is selectable so a reader can copy part
            // of a note the same way they copy part of a verse.
            className={
              'space-y-2 rounded-md px-3 py-2 ' +
              (sel
                ? 'bg-blue-500/20 text-foreground dark:bg-blue-400/25'
                : hit
                  ? 'bg-highlight/30 text-foreground'
                  : 'bg-muted/40 text-muted-foreground')
            }
          >
            <RefBody
              paragraphs={paras}
              bookNo={bookNo}
              chapterNo={chapterNo}
              marker={
                <sup className="px-0.5 text-[0.7em] font-sans font-medium tabular-nums text-destructive">
                  {n.n}
                </sup>
              }
            />
          </li>
        )
      })}
    </ul>
  )
}
