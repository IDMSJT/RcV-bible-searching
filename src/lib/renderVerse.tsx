import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { parseRefs, type ParseOptions, type Segment, type VerseRef } from '@/lib/parseRefs'
import { groupRefs, type RefGroup } from '@/lib/refGroups'
import { useBible, useAnnotations, eachVerseInRange, notesForVerse } from '@/data/loadBible'
import { formatVerseRef } from '@/lib/cite'
import { revealInScroll } from '@/lib/revealInScroll'
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
  'relative -top-[0.6em] -m-1 cursor-pointer p-1 text-[0.75em] font-sans font-medium tabular-nums text-destructive select-none hover:text-destructive/80'

/** Render verse text with three overlays:
 *   - semantic Marks (pn / png / add) as styled spans
 *   - footnote Annotations as clickable <sup> numbers at given char offsets
 *   - cross-references (串珠) as clickable <sup> letters
 * Any may be empty / omitted — when all are, returns the bare string so callers
 * can short-circuit the ReactNode wrapper.
 */
/** Everything anchored at one position in the verse: what a merged marker
 * stands for, and what a tap on it acts on. */
export interface MarkersAt {
  notes: number[]
  refs: string[]
}

export function renderMarkedText(
  text: string,
  marks?: Mark[],
  notes?: Annotation[],
  crossRefs?: CrossRef[],
  onMarkers?: (at: MarkersAt) => void,
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

  // Markers sharing one position are one button. Written 「1ab」 they look like
  // one already, and 13% of the corpus' 38,000 marker positions carry more than
  // a single marker — each of them a target a fraction of a character wide,
  // where a miss opens the wrong thing. Position, not adjacency, is what joins
  // them: two markers on neighbouring characters read as close together but
  // belong to different words.
  const flushSupsAt = (p: number) => {
    const here: typeof sups = []
    while (sIdx < sups.length && sups[sIdx].offset === p) here.push(sups[sIdx++])
    if (here.length === 0) return
    const at: MarkersAt = {
      notes: here.filter((s) => s.kind === 'note').map((s) => Number(s.id)),
      refs: here.filter((s) => s.kind === 'ref').map((s) => s.id),
    }
    out.push(
      <sup
        key={`s${keyCounter++}`}
        onClick={
          onMarkers
            ? (e) => {
                // Stop the surrounding row's click handler (e.g. lookup result
                // rows that navigate on tap) from also firing.
                e.stopPropagation()
                onMarkers(at)
              }
            : undefined
        }
        className={SUP_CLS}
      >
        {here.map((s) => s.label).join('')}
      </sup>,
    )
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
/**
 * Which citation a body has open: its place among all the citations in the
 * body, counted straight through the paragraphs.
 *
 * The verses it names used to travel with it. They don't now — the body
 * re-derives them from the same parse that drew the citation, so there is one
 * answer instead of a copy that can disagree with what is on screen. It also
 * makes the value a number, which is all a caller needs to write down.
 */
export type Open = number

function VersePreview({
  refs,
  ctx,
  divideBelow,
  innerRef,
}: {
  refs: VerseRef[]
  /** chapter is null where the surrounding text has none of its own — every
   * label then carries its chapter, which is what a book introduction wants. */
  ctx: { book: number; chapter: number | null }
  /** Whether any card content follows — the closing rule is only drawn when
   * there is something below to separate from. */
  divideBelow: boolean
  innerRef?: (el: HTMLElement | null) => void
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
      ref={innerRef}
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
        'mt-2 grid clear-both max-h-96 grid-cols-[auto_1fr] gap-x-2 gap-y-1 overflow-y-auto border-t border-border/60 pt-2 font-serif text-foreground',
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
          {/* A note body carries its own paragraph breaks, and often its own
            * citations — 「見弗一2註1」 opens a note that cites two more. Those go
            * to the verse rather than opening here: a second set of verses
            * inside this one would sit behind the column of labels above it,
            * and further right again at every step. The label beside each row
            * already navigates, so this reads the same way. Verse text is
            * scripture and cites nothing, so it stays plain. */}
          <div className={r.note != null ? 'space-y-1' : undefined}>
            {r.note != null ? (
              r.text
                .split('\n')
                .map((para, k) => (
                  <p key={k}>{renderNoteText(para, { book: r.bookNo, chapter: r.chapterNo })}</p>
                ))
            ) : (
              <p>{r.text}</p>
            )}
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

/**
 * Every paragraph of a body parsed once, each with the number its first
 * citation carries.
 *
 * Citations are numbered straight through the body rather than restarted per
 * paragraph, so one number names one citation and a caller can write it down
 * without knowing how the text happens to be broken up. The count has to be
 * known before any paragraph is drawn, which is why this runs ahead of the
 * render rather than inside it.
 */
function parseBody(
  paragraphs: string[],
  ctx: { book: number; chapter: number | null },
  kind?: ParseOptions['kind'],
) {
  const out: { para: string; segments: Segment[]; groups: RefGroup[]; base: number }[] = []
  let counted = 0
  for (const para of paragraphs) {
    const { segments } = parseRefs(para, ctx, { kind })
    const groups = segments.length > 0 ? groupRefs(segments) : []
    out.push({ para, segments, groups, base: counted })
    counted += groups.length
  }
  return out
}

export function RefBody({
  paragraphs,
  bookNo,
  chapterNo,
  marker,
  continuous,
  kind,
  open,
  onOpen,
}: {
  paragraphs: string[]
  bookNo: number
  /** null when the text names no chapter of its own to inherit — a book
   * introduction, say, where a bare number would otherwise resolve against a
   * chapter zero that no book has. */
  chapterNo: number | null
  /** Rendered before the first paragraph — the note number / cross-ref letter. */
  marker?: ReactNode
  /** The body sits in running text rather than a card of its own, so more of
   * the passage follows below whatever this paragraph ends on. A preview then
   * always needs a rule under it; in a card it only earns one when there is
   * something left in the card to separate from. */
  continuous?: boolean
  /** What sort of text this is, for the parser's sake — see ParseOptions. */
  kind?: ParseOptions['kind']
  /** Which reference is open, when the caller wants to decide. A body keeps
   * one open at a time on its own; passing this lets several share the one
   * between them, so opening a verse in one closes whatever another had open.
   * Keys are only compared within a body, so callers may reuse them as long as
   * at most one body is given a non-null value. */
  open?: Open | null
  onOpen?: (open: Open | null) => void
}): ReactNode {
  const [ownActive, setOwnActive] = useState<Open | null>(null)
  const active = open !== undefined ? open : ownActive
  const setActive = (next: Open | null) => (onOpen ? onOpen(next) : setOwnActive(next))
  // Measured per active ref. Keyed so that switching refs renders unsplit for a
  // layout pass first — measuring a paragraph that is already broken would read
  // back the wrong line.
  const [split, setSplit] = useState<{ key: Open; at: number } | null>(null)
  const paraRef = useRef<HTMLParagraphElement | null>(null)
  const previewRef = useRef<HTMLElement | null>(null)
  // Which reference's verses have already been brought into view, so a
  // re-measure doesn't scroll a second time. Seeded with whatever was open at
  // mount: a citation restored from a previous visit was not tapped just now,
  // and scrolling to it would move a page the reader hasn't touched.
  const revealed = useRef<Open | null>(open ?? null)
  const refElRef = useRef<HTMLElement | null>(null)
  // Which ref's break has already been checked against what actually rendered.
  const checkedRef = useRef<Open | null>(null)
  const ctx = { book: bookNo, chapter: chapterNo }

  const parsed = parseBody(paragraphs, ctx, kind)

  // The verses open below the citation, which on a long paragraph can leave
  // them off the bottom of the screen — the reader taps and nothing appears to
  // happen. Waits for the break to settle, since that is what decides where
  // they land, and only once per reference opened.
  useLayoutEffect(() => {
    if (active == null) {
      revealed.current = null
      return
    }
    if (split?.key !== active || revealed.current === active) return
    revealed.current = active
    if (previewRef.current) revealInScroll(previewRef.current)
  }, [active, split])

  useLayoutEffect(() => {
    if (active == null) return
    if (split?.key === active) return
    const p = paraRef.current
    const r = refElRef.current
    if (!p || !r) return
    setSplit({ key: active, at: lineEndAfter(p, r) })
  }, [active, split])

  // The head is a paragraph in its own right once the break lands, and the
  // browser wraps it a shade tighter than the same words were wrapped mid-flow —
  // tight enough to strand the last character on a line of its own. Measuring a
  // detached copy doesn't reproduce that, so read back what actually rendered
  // and pull the break in front of the stranded characters. Runs once per ref;
  // the pulled-back break ends on a full line, so it settles immediately.
  useLayoutEffect(() => {
    if (active == null || !split || split.key !== active) return
    if (checkedRef.current === active) return
    checkedRef.current = active
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
    if (lo > 0 && total - lo <= ORPHAN_MAX) setSplit({ key: active, at: lo })
  }, [active, split])

  const splitAt = active != null && split?.key === active ? split.at : null

  return (
    <>
      {parsed.map(({ para, segments, groups, base }, pi) => {
        if (segments.length === 0) {
          return (
            <p key={pi}>
              {pi === 0 && marker}
              {para}
            </p>
          )
        }

        // Citations of one chapter written in a row — 「賽十一1，2」 — are one
        // citation with two verses in it, and open together. A different
        // chapter is a different place however close it is written, so
        // 「撒上十六1，11～13，十七12」 stays two. The punctuation between members
        // belongs to the group, so the tint runs unbroken across it. (Grouped
        // above, with the rest of the parse.)
        const activeHere = active != null && active >= base && active < base + groups.length

        // What the paragraph is built from: a group of citations, or a run of
        // plain text between two of them. This is the unit the break cuts, so a
        // group is one span until a wrap actually divides it.
        type Unit = { gi: number; text: string; start: number; end: number }
        const units: Unit[] = []
        {
          let at = 0
          let plain = ''
          let plainStart = 0
          const flushPlain = () => {
            if (!plain) return
            units.push({ gi: -1, text: plain, start: plainStart, end: at })
            plain = ''
          }
          for (let si = 0; si < segments.length; si++) {
            const gi = groups.findIndex((g) => si === g.from)
            if (gi < 0) {
              if (!plain) plainStart = at
              plain += segments[si].text
              at += segments[si].text.length
              continue
            }
            flushPlain()
            const g = groups[gi]
            const text = segments
              .slice(g.from, g.to + 1)
              .map((x) => x.text)
              .join('')
            units.push({ gi, text, start: at, end: at + text.length })
            at += text.length
            si = g.to
          }
          flushPlain()
        }

        // `half` keeps React's sibling keys apart where a wrap has put the two
        // pieces of one unit in different arrays. It must not touch the key the
        // open citation is named by: a piece keyed by a made-up index once
        // opened a reference no unsplit rendering could hold, and since every
        // tap re-renders unsplit to measure the break, the tap measured nothing
        // and nothing appeared.
        const renderUnit = (u: Unit, text?: string, half?: string) => {
          const body = text ?? u.text
          if (u.gi < 0) {
            return <Fragment key={`${u.start}${half ?? ''}`}>{body}</Fragment>
          }
          const key = base + u.gi
          const on = active === key
          return (
            <span
              key={`${u.start}${half ?? ''}`}
              // The break is measured from where the citation starts, so only a
              // leading piece is the anchor.
              ref={
                on && half !== 'b'
                  ? (el) => {
                      refElRef.current = el
                    }
                  : undefined
              }
              role="button"
              tabIndex={0}
              // The card itself may select the note on tap (and lookup rows
              // navigate) — keep both off this ref.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                checkedRef.current = null
                setActive(on ? null : key)
              }}
              className={cn(
                'cursor-pointer rounded-sm text-primary hover:text-primary/80',
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
              {units.map((u) => renderUnit(u))}
            </p>
          )
        }

        // Break at the end of the line the ref was read on, so the verses land
        // directly beneath it instead of at the foot of a long note — and the
        // line keeps its full measure rather than stopping at the ref.
        const head: ReactNode[] = []
        const tail: ReactNode[] = []
        for (const u of units) {
          if (u.end <= splitAt) head.push(renderUnit(u))
          else if (u.start >= splitAt) tail.push(renderUnit(u))
          else if (active === base + u.gi) {
            // The citation being read stays whole: it is the element the break
            // is measured from, and cutting it would move the anchor the next
            // measurement reads. Everything else wraps like the prose around it,
            // so the rule lands where the line really ended instead of being
            // pushed past whatever happened to straddle it.
            head.push(renderUnit(u))
          } else {
            head.push(renderUnit(u, u.text.slice(0, splitAt - u.start), 'a'))
            tail.push(renderUnit(u, u.text.slice(splitAt - u.start), 'b'))
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
              refs={groups[active! - base].refs}
              ctx={ctx}
              divideBelow={continuous || hasTail || pi < paragraphs.length - 1}
              innerRef={(el) => {
                previewRef.current = el
              }}
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
      className="float-right m-[0.0625em] -mr-[0.25em] ml-[0.125em] rounded p-[0.25em] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
    >
      <X className="size-[1em]" />
    </button>
  )
}

/** The card for one cross-reference: its letter, the verses it points at, and a
 * ✕ when it can be dismissed. Split out of CrossRefList so a caller can put
 * these in whatever order it needs. */
export function CrossRefCard({
  crossRef: r,
  verse,
  bookNo,
  chapterNo,
  onClose,
  open,
  onOpen,
}: {
  crossRef: CrossRef
  /** The verse this hangs off, used only to key the card in the DOM so the
   * reader can be taken to one that opened out of sight. */
  verse?: number
  bookNo: number
  chapterNo: number
  onClose?: (m: string) => void
  /** Which citation inside this card is open. Omitted, the card keeps its own
   * — a caller passes these only to hold the choice somewhere that outlives the
   * card, such as the chapter's saved state. */
  open?: Open | null
  onOpen?: (open: Open | null) => void
}): ReactNode {
  return (
    <li
      data-crossref={verse != null ? `${verse}:${r.m}` : undefined}
      // The card sits inside the verse, which selects itself when tapped. A tap
      // in here is aimed at the card, so it stops here. (The note card gets this
      // from the handler that selects it; this one has nothing else to do, so it
      // has to say so.) Citations inside stop their own clicks and still work.
      onClick={(e) => e.stopPropagation()}
      className="space-y-2 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground"
    >
      <RefBody
        paragraphs={[r.refs]}
        kind="list"
        bookNo={bookNo}
        chapterNo={chapterNo}
        open={open}
        onOpen={onOpen}
        marker={
          <>
            {onClose && <CloseButton onClose={() => onClose(r.m)} label={`關閉串珠 ${r.m}`} />}
            <sup className="px-0.5 text-[0.75em] font-sans font-medium tabular-nums text-destructive">
              {r.m}
            </sup>
          </>
        }
      />
    </li>
  )
}

/** The list these cards sit in, on its own so several kinds can share one. */
export function CardList({ children }: { children: ReactNode }): ReactNode {
  return (
    <ul className="mt-2 space-y-2 font-sans text-[0.95em] font-light leading-relaxed">
      {children}
    </ul>
  )
}

export function CrossRefList({
  refs,
  verse,
  bookNo,
  chapterNo,
  onClose,
}: {
  refs: CrossRef[]
  verse?: number
  bookNo: number
  chapterNo: number
  /** Collapse this cross-ref again — renders the card's ✕ when given. */
  onClose?: (m: string) => void
}): ReactNode {
  if (refs.length === 0) return null
  return (
    <CardList>
      {refs.map((r) => (
        <CrossRefCard
          key={r.m}
          crossRef={r}
          verse={verse}
          bookNo={bookNo}
          chapterNo={chapterNo}
          onClose={onClose}
        />
      ))}
    </CardList>
  )
}

/** The card for one footnote. Split out of NoteList for the same reason as the
 * cross-reference's. */
export function NoteCard({
  note: n,
  verse,
  bookNo,
  chapterNo,
  onClose,
  highlighted,
  selected,
  onSelect,
  open,
  onOpen,
}: {
  note: Annotation
  verse?: number
  bookNo: number
  chapterNo: number
  onClose?: (n: number) => void
  highlighted?: boolean
  selected?: boolean
  onSelect?: (n: number) => void
  /** Which citation inside this card is open — see CrossRefCard. */
  open?: Open | null
  onOpen?: (open: Open | null) => void
}): ReactNode {
  // Split the note body on the restored paragraph breaks so we can render each
  // as its own <p> with space-y between — whitespace-pre-line would collapse
  // the inter-paragraph gap too tight.
  const paras = n.text.split('\n')
  return (
    <li
      data-note={verse != null ? `${verse}:${n.n}` : undefined}
      // stopPropagation on pointerdown keeps the surrounding verse's long-press
      // from firing; onClick selects the note (ref links inside stop their own
      // propagation, so they still navigate).
      onPointerDown={onSelect ? (e) => e.stopPropagation() : undefined}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation()
              onSelect(n.n)
            }
          : undefined
      }
      // No select-none: the body is selectable so a reader can copy part of a
      // note the same way they copy part of a verse.
      className={
        'space-y-2 rounded-md px-3 py-2 ' +
        (selected
          ? 'bg-blue-500/20 text-foreground dark:bg-blue-400/25'
          : highlighted
            ? 'bg-highlight/25 text-foreground'
            : 'bg-muted/40 text-muted-foreground')
      }
    >
      <RefBody
        paragraphs={paras}
        bookNo={bookNo}
        chapterNo={chapterNo}
        open={open}
        onOpen={onOpen}
        marker={
          <>
            {onClose && <CloseButton onClose={() => onClose(n.n)} label={`關閉註釋 ${n.n}`} />}
            <sup className="px-0.5 text-[0.75em] font-sans font-medium tabular-nums text-destructive">
              {n.n}
            </sup>
          </>
        }
      />
    </li>
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
    <CardList>
      {notes.map((n) => (
        <NoteCard
          key={n.n}
          note={n}
          verse={verse}
          bookNo={bookNo}
          chapterNo={chapterNo}
          onClose={onClose}
          highlighted={highlightedNs?.has(n.n)}
          selected={selectedNs?.has(n.n)}
          onSelect={onSelectNote}
        />
      ))}
    </CardList>
  )
}
