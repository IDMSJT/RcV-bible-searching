import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { parseRefs, type VerseRef } from '@/lib/parseRefs'
import { useBible, useAnnotations, eachVerseInRange, notesForVerse } from '@/data/loadBible'
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
    ...(crossRefs ?? []).flatMap((r) =>
      r.offsets.map((offset) => ({ kind: 'ref' as const, label: r.m, id: r.m, offset })),
    ),
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
  divideBelow,
}: {
  refs: VerseRef[]
  ctx: { book: number; chapter: number }
  /** Whether any card content follows — the closing rule is only drawn when
   * there is something below to separate from. */
  divideBelow: boolean
}): ReactNode {
  const { data: bible } = useBible()
  // A ref can point at a footnote rather than the text (「見10註2」), in which
  // case that note is what the reader wants to see. Only pull annotations.json
  // when one of these refs actually needs it.
  const wantsNotes = refs.some((r) => r.note != null || r.noteAll)
  const { data: annotations } = useAnnotations(wantsNotes)
  if (!bible) return null

  type Row = { bookNo: number; chapterNo: number; verse: number; note?: number; text: string }
  const rows: Row[] = []
  for (const ref of refs) {
    const wantsNote = ref.note != null || ref.noteAll
    // 「二1註3」 targets the note alone; 「二1與註3」 wants the verse as well.
    const wantsVerse = !wantsNote || !ref.noteDirect
    // Walk the whole span, not just its first verse — 「賽十四12～15與註」 means
    // every verse in the range along with the notes on each. Each verse is
    // followed by its own notes so the two read together.
    for (const { chapterNo, verse } of eachVerseInRange(
      bible,
      ref.bookNo,
      ref.chapter,
      ref.endChapter,
      ref.verseStart,
      ref.verseEnd,
    )) {
      if (wantsVerse) {
        rows.push({ bookNo: ref.bookNo, chapterNo, verse: verse.verse, text: verse.text })
      }
      if (wantsNote && annotations) {
        const all = notesForVerse(annotations, ref.bookNo, chapterNo, verse.verse)
        for (const n of ref.noteAll ? all : all.filter((x) => x.n === ref.note)) {
          rows.push({
            bookNo: ref.bookNo,
            chapterNo,
            verse: verse.verse,
            note: n.n,
            text: n.text,
          })
        }
      }
    }
  }
  if (rows.length === 0) return null
  const ref0 = refs[0]
  const sameChapter = ref0.bookNo === ctx.book && ref0.chapter === ctx.chapter

  return (
    // Same two-column shape as the search results: a narrow citation column
    // whose labels line up, verse text flowing in the rest.
    <div
      // A long span (「賽十四12～15與註」 pulls in four verses plus every note on
      // them) scrolls in place rather than being cut short — the reader can
      // still reach all of it without the card swallowing the page.
      // stopPropagation keeps a tap in here off the card's own select handler.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        // clear-both: the dismiss button floats inside the paragraph above, and a
        // float doesn't grow its parent, so without this it can hang over the
        // preview whenever the break lands after only a line or two.
        'mt-2 grid clear-both max-h-96 grid-cols-[auto_1fr] gap-x-2 gap-y-1 overflow-y-auto overscroll-contain border-t border-border/60 pt-2 font-serif text-foreground',
        divideBelow && 'mb-2 border-b pb-2',
      )}
    >
      {rows.map((r, i) => (
        <Fragment key={i}>
          <Link
            to="/$bookNo/$chapterNo"
            params={{ bookNo: r.bookNo, chapterNo: r.chapterNo }}
            search={{ hl: r.note != null ? `${r.verse}:${r.note}` : String(r.verse) }}
            resetScroll={sameChapter ? false : undefined}
            onClick={(e) => e.stopPropagation()}
            className="self-start whitespace-nowrap pt-[0.25em] text-left text-[0.8em] font-sans text-primary transition-colors hover:text-primary/80"
          >
            {formatVerseRef(r.bookNo, r.chapterNo, r.verse, 'colon')}
            {r.note != null && `註${r.note}`}
          </Link>
          {/* A note body carries its own paragraph breaks. */}
          <div className={r.note != null ? 'space-y-1' : undefined}>
            {r.note != null ? r.text.split('\n').map((para, k) => <p key={k}>{para}</p>) : <p>{r.text}</p>}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** Card body shared by notes and cross-refs: the prose, with every embedded ref
 * tappable. Tapping a ref reveals its verses at the foot of the card; tapping
 * another switches to it, and tapping the same one again closes it. */
/** Character index (into the paragraph's own text, ignoring the marker sup)
 * where the visual line *after* `refEl`'s last line begins — i.e. the point at
 * which we can break the paragraph without leaving a ragged half-line. Returns
 * the text length when the ref already sits on the final line.
 *
 * Line boxes aren't addressable in the DOM, so this reads them back off the
 * rendered layout: every character's top edge is non-decreasing in document
 * order, which makes "first character on a lower line" a binary search. */
/** The paragraph's own text nodes, in order, with each one's start index. The
 * marker <sup> is skipped: it sits in the paragraph but isn't part of its text,
 * so counting it would shift every index. */
function textNodesOf(root: HTMLElement): { node: Text; start: number }[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const out: { node: Text; start: number }[] = []
  let total = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    out.push({ node: t, start: total })
    total += t.length
  }
  return out
}

function topOf(nodes: { node: Text; start: number }[], i: number): number {
  const hit = nodes.find(({ node, start }) => i >= start && i < start + node.length)
  if (!hit) return Infinity
  const range = document.createRange()
  range.setStart(hit.node, i - hit.start)
  range.setEnd(hit.node, i - hit.start + 1)
  return range.getBoundingClientRect().top
}

/** Whether character `i` is the first on its line. Probing one character can't
 * tell: a Range covering the first character after a soft wrap is commonly
 * reported back at the end of the previous line, which reads as "same line" and
 * puts the break one character too late. A Range spanning `i-1` and `i` is
 * unambiguous — when they sit on different lines the browser returns a rect for
 * each. */
function startsLine(nodes: { node: Text; start: number }[], i: number): boolean {
  if (i <= 0) return false
  const a = nodes.find(({ node, start }) => i - 1 >= start && i - 1 < start + node.length)
  const b = nodes.find(({ node, start }) => i >= start && i < start + node.length)
  if (!a || !b) return false
  const range = document.createRange()
  range.setStart(a.node, i - 1 - a.start)
  range.setEnd(b.node, i - b.start + 1)
  return range.getClientRects().length > 1
}

/** A head line with no more than this many characters reads as a stranded
 * fragment rather than a line, so the break moves in front of it. */
const ORPHAN_MAX = 2

function lineEndAfter(container: HTMLElement, refEl: HTMLElement): number {
  const rects = refEl.getClientRects()
  if (rects.length === 0) return -1
  const lineTop = rects[rects.length - 1].top

  const nodes = textNodesOf(container)
  const total = nodes.reduce((n, x) => n + x.node.length, 0)
  if (total === 0) return -1

  let refEnd = 0
  for (const { node, start } of nodes) {
    if (refEl.contains(node)) refEnd = Math.max(refEnd, start + node.length)
  }
  if (refEnd === 0) return -1

  // First index after the ref that renders on a lower line.
  let lo = refEnd
  let hi = total
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (topOf(nodes, mid) > lineTop + 1) hi = mid
    else lo = mid + 1
  }
  if (lo >= total) return total
  // Correct for the probe's blind spot: if the character just before the
  // candidate already starts a line, that's where the break belongs.
  if (lo - 1 > refEnd && startsLine(nodes, lo - 1)) lo -= 1

  // The head will be a paragraph in its own right, and the browser wraps a
  // truncated paragraph a little tighter — the character that sat at the end of
  // the line here can drop to a line of its own there. When that happens the
  // copy's last line starts at a character this layout still had on the ref's
  // line, so break there instead and let those characters go with the tail.

  return lo
}

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
  // Measured per active ref. Keyed so that switching refs renders unsplit for a
  // layout pass first — measuring a paragraph that is already broken would read
  // back the wrong line.
  const [split, setSplit] = useState<{ key: string; at: number } | null>(null)
  const paraRef = useRef<HTMLParagraphElement | null>(null)
  const refElRef = useRef<HTMLElement | null>(null)
  // Which ref's break has already been checked against what actually rendered.
  const checkedRef = useRef<string | null>(null)
  const ctx = { book: bookNo, chapter: chapterNo }

  useLayoutEffect(() => {
    if (!active) return
    if (split?.key === active.key) return
    const p = paraRef.current
    const r = refElRef.current
    if (!p || !r) return
    setSplit({ key: active.key, at: lineEndAfter(p, r) })
  }, [active, split])

  // The head is a paragraph in its own right once the break lands, and the
  // browser wraps it a shade tighter than the same words were wrapped mid-flow —
  // tight enough to strand the last character on a line of its own. Measuring a
  // detached copy doesn't reproduce that, so read back what actually rendered
  // and pull the break in front of the stranded characters. Runs once per ref;
  // the pulled-back break ends on a full line, so it settles immediately.
  useLayoutEffect(() => {
    if (!active || !split || split.key !== active.key) return
    if (checkedRef.current === active.key) return
    checkedRef.current = active.key
    const p = paraRef.current
    if (!p) return
    const nodes = textNodesOf(p)
    const total = nodes.reduce((n, x) => n + x.node.length, 0)
    if (total < 2) return
    const lastTop = topOf(nodes, total - 1)
    let lo = 0
    let hi = total - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (topOf(nodes, mid) >= lastTop - 1) hi = mid
      else lo = mid + 1
    }
    if (lo > 0 && total - lo <= ORPHAN_MAX) setSplit({ key: active.key, at: lo })
  }, [active, split])

  const splitAt = active && split?.key === active.key ? split.at : null

  return (
    <>
      {paragraphs.map((para, pi) => {
        const { segments } = parseRefs(para, ctx)
        if (segments.length === 0) {
          return (
            <p key={pi}>
              {pi === 0 && marker}
              {para}
            </p>
          )
        }

        const activeHere = active?.key.startsWith(`${pi}:`) ?? false

        const renderSeg = (seg: (typeof segments)[number], si: number, text?: string) => {
          const body = text ?? seg.text
          if (!seg.refs || seg.refs.length === 0) {
            return <Fragment key={si}>{body}</Fragment>
          }
          const key = `${pi}:${si}`
          const on = active?.key === key
          return (
            <span
              key={si}
              ref={on ? (el) => { refElRef.current = el } : undefined}
              role="button"
              tabIndex={0}
              // The card itself may select the note on tap (and lookup rows
              // navigate) — keep both off this ref.
              onPointerDown={(e) => e.stopPropagation()}
              // Mouse users just sweep across the refs to read them; gated on
              // pointerType so a touch's synthetic hover doesn't fire ahead of
              // the tap on mobile.
              onClick={(e) => {
                e.stopPropagation()
                checkedRef.current = null
                setActive(on ? null : { key, refs: seg.refs! })
              }}
              className={cn(
                'cursor-pointer rounded text-primary hover:text-primary/80',
                on && 'bg-primary/15',
              )}
            >
              {body}
            </span>
          )
        }

        // Not this paragraph's ref, or the split isn't measured yet — render
        // whole. The unmeasured pass is what the layout effect measures against.
        if (!activeHere || splitAt == null || splitAt < 0) {
          return (
            <p key={pi} ref={activeHere ? paraRef : undefined}>
              {pi === 0 && marker}
              {segments.map((seg, si) => renderSeg(seg, si))}
            </p>
          )
        }

        // Break at the end of the line the ref was read on, so the verses land
        // directly beneath it instead of at the foot of a long note — and the
        // line keeps its full measure rather than stopping at the ref.
        const head: ReactNode[] = []
        const tail: ReactNode[] = []
        let pos = 0
        for (let si = 0; si < segments.length; si++) {
          const seg = segments[si]
          const start = pos
          const end = pos + seg.text.length
          pos = end
          if (end <= splitAt) head.push(renderSeg(seg, si))
          else if (start >= splitAt) tail.push(renderSeg(seg, si))
          else if (seg.refs && seg.refs.length > 0 && active?.key === `${pi}:${si}`) {
            // The citation being read stays whole: it is the element the break
            // is measured from, and cutting it would move the anchor the next
            // measurement reads. Every other citation wraps like the prose
            // around it, so the rule lands where the line really ended instead
            // of being pushed past a citation that happened to straddle it.
            head.push(renderSeg(seg, si))
          } else {
            head.push(renderSeg(seg, si, seg.text.slice(0, splitAt - start)))
            tail.push(renderSeg(seg, si + segments.length, seg.text.slice(splitAt - start)))
          }
        }
        const hasTail = tail.length > 0
        return (
          <Fragment key={pi}>
            <p ref={paraRef}>
              {pi === 0 && marker}
              {head}
            </p>
            <VersePreview
              refs={active!.refs}
              ctx={ctx}
              divideBelow={hasTail || pi < paragraphs.length - 1}
            />
            {hasTail && <p>{tail}</p>}
          </Fragment>
        )
      })}
    </>
  )
}

/** The cross-references (串珠) opened on a verse — same card treatment as the
 * footnotes above, with the marker letter leading the line and each citation
 * tappable to peek at the verses it points to. */
/** Dismiss control in a card's top-right corner. Floated rather than absolutely
 * placed so the prose flows around it — only the line it sits on is shortened,
 * instead of a gutter being reserved down the whole card. The negative margins
 * pull it out of the card's uneven px-3/py-2 padding so the glyph ends up the
 * same distance from the top and right edges. stopPropagation keeps the tap off
 * the card's own select/navigate handlers. */
function CloseButton({ onClose, label }: { onClose: () => void; label: string }): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      // Sized in em so it tracks the reading font-size setting along with the
      // text it sits beside.
      className="float-right -mr-[0.25em] ml-[0.125em] rounded p-[0.25em] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
    >
      <X className="size-[1em]" />
    </button>
  )
}

export function CrossRefList({
  refs,
  bookNo,
  chapterNo,
  onClose,
}: {
  refs: CrossRef[]
  bookNo: number
  chapterNo: number
  /** Collapse this cross-ref again — renders the card's ✕ when given. */
  onClose?: (m: string) => void
}): ReactNode {
  if (refs.length === 0) return null
  return (
    <ul className="mt-2 space-y-2 font-sans text-[0.95em] font-light leading-relaxed">
      {refs.map((r) => (
        <li
          key={r.m}
          className="space-y-2 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground"
        >
          <RefBody
            paragraphs={[r.refs]}
            bookNo={bookNo}
            chapterNo={chapterNo}
            marker={
              <>
                {onClose && <CloseButton onClose={() => onClose(r.m)} label={`關閉串珠 ${r.m}`} />}
                <sup className="px-0.5 text-[0.7em] font-sans font-medium tabular-nums text-destructive">
                  {r.m}
                </sup>
              </>
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
  onClose,
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
  /** Collapse this note again — renders the card's ✕ when given. */
  onClose?: (n: number) => void
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
                <>
                  {onClose && <CloseButton onClose={() => onClose(n.n)} label={`關閉註釋 ${n.n}`} />}
                  <sup className="px-0.5 text-[0.7em] font-sans font-medium tabular-nums text-destructive">
                    {n.n}
                  </sup>
                </>
              }
            />
          </li>
        )
      })}
    </ul>
  )
}
