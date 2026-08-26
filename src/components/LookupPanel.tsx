import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { parseRefs, type Segment, type VerseRef } from '@/lib/parseRefs'
import {
  refsExist,
  resolveRefs,
  searchKeyword,
  type ResolvedVerse,
} from '@/lib/lookupResults'
import { groupRefs } from '@/lib/refGroups'
import { tokenPattern } from '@/lib/variants'
import { useBible, useBibleEn, useAnnotations } from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { BOOK_ABBREV_EN } from '@/data/abbrevEn'
import {
  formatVerseRef,
  formatCitation,
  DEFAULT_CITE_FORMAT,
  DEFAULT_CITE_POSITION,
  DEFAULT_COPY_LANG,
  type CiteFormat,
  type CitePosition,
  type CopyLang,
} from '@/lib/cite'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/lib/useIsMobile'
import { useCarousel } from '@/lib/useCarousel'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { renderMarkedText, renderNoteText } from '@/lib/renderVerse'
import { InputActions } from '@/components/InputActions'
import { ScrollBody } from '@/components/ScrollBody'
import { ACTION_BAR_CLS } from '@/lib/chrome'
import { cn } from '@/lib/utils'

// The /search field, shared by both tabs (and both viewports) so they read
// identically: one muted box. The chrome (border, fill, focus ring) lives on
// the shell; the input inside is transparent so the 經節 tab can lay a
// same-metrics highlight backdrop under the caret.
const FIELD_SHELL =
  'relative overflow-hidden rounded-xl border border-border bg-muted/40 transition-colors focus-within:border-ring'
// Starts one line tall (min-h-11 = a line + padding) and is grown to fit its
// content by autoGrow() up to max-h-40, then scrolls. field-sizing-fixed keeps
// the browser out of the sizing so autoGrow owns it — the CSS field-sizing that
// would do this natively isn't in older Safari/Chrome, and this works
// everywhere. border-0 + bg-transparent drop the base Textarea's own chrome so
// only the shell's shows; min-h overrides its min-h-16.
const FIELD_INPUT =
  'block max-h-40 min-h-11 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2.5 font-serif text-base leading-relaxed break-words whitespace-pre-wrap shadow-none outline-none field-sizing-fixed focus-visible:ring-0 dark:bg-transparent [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

/** Grow a textarea to fit its text: reset to auto to measure, then to the
 * scroll height. CSS max-h caps the visible height and turns on the scrollbar
 * past it, so this only ever needs to set the height, not clamp it. */
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const PLACEHOLDER =
  '輸入經文出處，例如：\n約翰福音一章一節，三章十六節，十四章六節'

function refHl(ref: VerseRef): string {
  // Cross-chapter range → 「chA:vA-chB:vB」. ChapterView clips it to the
  // chapter being viewed. Mutually exclusive with the note forms.
  if (ref.endChapter !== ref.chapter) {
    return `${ref.chapter}:${ref.verseStart}-${ref.endChapter}:${ref.verseEnd}`
  }
  // Bare 註 (noteAll). Single verse → 「v:*」 = all notes (connected also tints
  // the verse). Range → tint the span AND expand every verse's notes.
  if (ref.noteAll) {
    if (ref.verseStart === ref.verseEnd) {
      return ref.noteDirect ? `${ref.verseStart}:*` : `${ref.verseStart},${ref.verseStart}:*`
    }
    const parts = [`${ref.verseStart}-${ref.verseEnd}`]
    for (let v = ref.verseStart; v <= ref.verseEnd; v++) parts.push(`${v}:*`)
    return parts.join(',')
  }
  // Direct 注N (noteDirect) → the note alone is the target, so the URL only
  // expands+tints that note. No verse range.
  if (ref.note != null && ref.noteDirect && ref.verseStart === ref.verseEnd) {
    return `${ref.verseStart}:${ref.note}`
  }
  const range =
    ref.verseStart === ref.verseEnd
      ? String(ref.verseStart)
      : `${ref.verseStart}-${ref.verseEnd}`
  // Connected 注N → tint verse AND expand note.
  return ref.note != null && ref.verseStart === ref.verseEnd
    ? `${range},${ref.verseStart}:${ref.note}`
    : range
}

function refKey(bookNo: number, chapterNo: number, hl: string): string {
  return `${bookNo}/${chapterNo}/${hl}`
}

/** Format a single resolved verse as a quotable line for copy. Returns an
 * empty string when the requested format needs English but the verse has none,
 * so callers can `.filter(Boolean)` and not emit blank lines. */
function formatCopyText(
  r: ResolvedVerse,
  format: 'zh' | 'en' | 'both',
  cite: CiteFormat,
  pos: CitePosition,
): string {
  // Note-only rows have no verse text and no English source — fold every
  // format down to the note body with a 註N-suffixed label.
  if (r.noteOnly && r.noteToShow) {
    if (format === 'en') return ''
    const label = `${formatVerseRef(r.bookNo, r.chapterNo, r.verse.verse, cite)}註${r.noteToShow.n}`
    return formatCitation(label, `『${r.noteToShow.text}』`, pos)
  }
  const zhLabel = formatVerseRef(r.bookNo, r.chapterNo, r.verse.verse, cite)
  const enLabel = `${BOOK_ABBREV_EN[r.bookNo] ?? ''} ${r.chapterNo}:${r.verse.verse}`
  const zh = formatCitation(zhLabel, `『${r.verse.text}』`, pos)
  if (format === 'zh') return zh
  const en = r.enText ? formatCitation(enLabel, `"${r.enText}"`, pos, ' ') : ''
  if (format === 'en') return en
  return r.enText ? `${zh}\n${en}` : zh
}

/** Does a parsed ref's (possibly cross-chapter) range cover this verse? Lets a
 * hovered result row — including the note rows a 與註 expands into — light its
 * source token in the input. */
function refCoversVerse(ref: VerseRef, bookNo: number, chapter: number, verse: number): boolean {
  if (ref.bookNo !== bookNo) return false
  if (chapter < ref.chapter || chapter > ref.endChapter) return false
  if (chapter === ref.chapter && verse < ref.verseStart) return false
  if (chapter === ref.endChapter && verse > ref.verseEnd) return false
  return true
}

function renderBackdrop(
  segments: Segment[],
  refFound: boolean[],
  activeKey: string | null,
  hoveredVerse: { bookNo: number; chapter: number; verse: number } | null,
  hoveredGroup: number | null,
) {
  // Citations of one chapter written in a row — 「賽十一1，2」 — read as one
  // citation, the way they do in the reading view: lit together, and with the
  // punctuation between them inside the tint so it runs unbroken.
  const groups = groupRefs(segments)

  // Segments are emitted in input order; ref segments carry the resolved
  // VerseRefs while everything else (prose, separators) renders plain. The flat
  // `refFound` cursor is keyed to the same VerseRef order as the results list,
  // so a segment with several refs (a 創一1、5 token that yields two) consumes
  // that many slots.
  const startOf: number[] = []
  let cursor = 0
  for (const seg of segments) {
    startOf.push(cursor)
    cursor += seg.refs?.length ?? 0
  }

  const state = groups.map((g) => {
    let resolved = true
    let lit = false
    for (let i = g.from; i <= g.to; i++) {
      const seg = segments[i]
      if (!seg.refs?.length) continue
      seg.refs.forEach((ref, j) => {
        if (refFound[startOf[i] + j] === false) resolved = false
        // active = the exact open ref; hover lights any token whose range covers
        // the hovered row's verse, so 與註-expanded note rows light it too.
        if (refKey(ref.bookNo, ref.chapter, refHl(ref)) === activeKey) lit = true
        if (
          hoveredVerse &&
          refCoversVerse(ref, hoveredVerse.bookNo, hoveredVerse.chapter, hoveredVerse.verse)
        ) {
          lit = true
        }
      })
    }
    return { resolved, lit }
  })

  // One span per group, so the tint is one box rather than several stitched
  // together. Prose between groups keeps its own place in the run.
  const out: ReactNode[] = []
  let at = 0
  for (const [gi, g] of groups.entries()) {
    for (; at < g.from; at++) out.push(<Fragment key={at}>{segments[at].text}</Fragment>)
    const { resolved, lit } = state[gi]
    // Same look a cross-reference has in the reading view: recognised refs read
    // as links, and the one in play picks up the tint. Colour and background
    // only — the backdrop has to stay glyph-for-glyph with the textarea above
    // it, so anything affecting metrics (weight, spacing) would break alignment.
    out.push(
      <span
        key={g.from}
        // Read back by the pointer hit-test: the backdrop can't be hovered, so
        // which citation the mouse is over is worked out from these boxes.
        data-group={gi}
        className={cn(
          'rounded-sm',
          resolved ? 'text-primary' : 'bg-destructive/15 text-destructive',
          resolved && (lit || hoveredGroup === gi) && 'bg-primary/15',
        )}
      >
        {segments
          .slice(g.from, g.to + 1)
          .map((s) => s.text)
          .join('')}
      </span>,
    )
    at = g.to + 1
  }
  for (; at < segments.length; at++) out.push(<Fragment key={at}>{segments[at].text}</Fragment>)
  return out
}

type LookupTab = 'ref' | 'kw'
const KW_RESULT_CAP = 500
// Stable empty-tokens reference so the 經節 panel's memoized ResultList isn't
// invalidated by a fresh [] on every parent re-render (e.g. each swipe frame).
const NO_TOKENS: string[] = []
// Stable empties for the inactive tab's panel (keeps the memoized ResultList /
// CopyAllBar from re-rendering during a swipe).
const EMPTY_SELECTION: ReadonlySet<number> = new Set()
const noop = () => {}

// Wrap every token occurrence (case-insensitive) in a highlighted <mark>. Used
// by the keyword tab so the visible text shows the user *what* matched their
// query, not just *which verse* matched.
function highlightTokens(text: string, tokens: string[]): ReactNode {
  if (!text || tokens.length === 0) return text
  // Longest-first so 「abc」 wins over 「ab」 at the same position when both
  // were in the query. RegExp's `g` walks left-to-right and the alternation
  // engine commits the first matching arm, so the order matters.
  const sorted = [...tokens].sort((a, b) => b.length - a.length)
  // Each char expands to its variant class (吃 → [吃喫]) so the mark lands on
  // whichever form the verse actually uses, not just the typed glyph.
  const pattern = sorted.map(tokenPattern).join('|')
  const re = new RegExp(`(${pattern})`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <mark key={`k${key++}`} className="rounded-sm bg-highlight/30 text-primary">
        {m[0]}
      </mark>,
    )
    last = re.lastIndex
    // Defensive guard for zero-length matches — none of the user-typed
    // tokens should produce them, but if they ever did the loop would spin.
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The result rows for one tab, memoized so a swipe (which re-renders the
 * parent every frame via `dx`) doesn't re-render the up-to-500-row list. All
 * props are referentially stable during a drag, so the memo holds. */
const ResultList = memo(function ResultList({
  rows,
  tokens,
  error,
  loading,
  isEmpty,
  hint,
  activeBookNo,
  activeChapterNo,
  activeHl,
  hovered,
  selected,
  selecting,
  onHover,
  onOpen,
  onToggle,
  fromHoveredRef,
}: {
  rows: ResolvedVerse[]
  /** Rows produced by the citation under the mouse, as a range over the flat
   * ref list — the whole block lights so it reads as one answer. */
  fromHoveredRef?: [number, number] | null
  tokens: string[]
  error: string | null
  loading: boolean
  isEmpty: boolean
  hint: string
  activeBookNo: number | null
  activeChapterNo: number | null
  activeHl: string | undefined
  hovered: number | null
  /** Indices of the currently selected rows (multi-select). */
  selected: ReadonlySet<number>
  /** True while a selection exists — tap toggles instead of navigating. */
  selecting: boolean
  onHover: (index: number, hovering: boolean) => void
  onOpen: (r: ResolvedVerse) => void
  onToggle: (index: number) => void
}) {
  if (error) return <p className="text-base text-destructive">資料載入失敗：{error}</p>
  if (isEmpty) return hint ? <p className="text-base text-muted-foreground">{hint}</p> : null
  if (loading) return <p className="text-base text-muted-foreground">載入中…</p>
  if (rows.length === 0) return <p className="text-base text-muted-foreground">找不到符合的經節</p>
  return (
    <div
      // Clear hover when leaving the list. Row spacing is each row's own py (not
      // a grid gap) so there's no dead strip between rows — hover always tracks
      // the row under the cursor without flicker.
      onMouseLeave={() => onHover(-1, false)}
      className="grid grid-cols-[auto_1fr] gap-x-2 font-serif text-[length:var(--reading-fs,1rem)] leading-normal md:text-[length:calc(var(--reading-fs,1rem)*0.9375)]"
    >
      {rows.map((r, i) => {
        const active =
          activeBookNo === r.bookNo && activeChapterNo === r.chapterNo && activeHl === refHl(r.ref)
        const fromHovered =
          fromHoveredRef != null &&
          r.refIndex != null &&
          r.refIndex >= fromHoveredRef[0] &&
          r.refIndex < fromHoveredRef[1]
        return (
          <ResultRow
            key={`${r.bookNo}-${r.chapterNo}-${r.verse.verse}-${i}`}
            resolved={r}
            highlightTokens={tokens}
            active={active}
            hover={hovered === i || fromHovered}
            selected={selected.has(i)}
            selecting={selecting}
            onHover={(h) => onHover(i, h)}
            onOpen={() => onOpen(r)}
            onToggle={() => onToggle(i)}
          />
        )
      })}
    </div>
  )
})

export function LookupPanel({ onNavigate }: { onNavigate?: () => void } = {}) {
  const [tab, setTab] = useLocalStorage<LookupTab>('rcv/lookup-tab', 'kw')
  const [q, setQ] = useLocalStorage('rcv/lookup-q', '')
  const [kw, setKw] = useLocalStorage('rcv/lookup-kw', '')
  const { data, error } = useBible()
  const [showEnglish] = useLocalStorage('rcv/show-english', false)
  const { data: bibleEn } = useBibleEn(showEnglish)
  // Annotations are loaded unconditionally because we only surface a note when
  // the input explicitly asks for it via 「注N」/「註N」 (太一21注3) — not as
  // an automatic per-verse decoration. 顯示註釋 setting only gates ChapterView's
  // own sup markers.
  const { data: annotations } = useAnnotations()
  const navigate = useNavigate()
  const location = useLocation()

  const activeMatch = location.pathname.match(/^\/(\d+)\/(\d+)/)
  const activeBookNo = activeMatch ? Number(activeMatch[1]) : null
  const activeChapterNo = activeMatch ? Number(activeMatch[2]) : null
  const activeHl = (location.search as { hl?: string }).hl
  const activeKey =
    activeBookNo != null && activeChapterNo != null && activeHl != null
      ? refKey(activeBookNo, activeChapterNo, activeHl)
      : null

  const { refs, segments } = useMemo(() => parseRefs(q), [q])
  const backdropRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const kwTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const isMobile = useIsMobile()

  // Two-tab carousel: [關鍵字, 經節] sit side by side in a 200%-wide track on
  // mobile; dragging slides between them and a release snaps to the nearer tab.
  // Reuses the reading pager's gesture hook — prev = 關鍵字 (left), next = 經節.
  const activeIndex = tab === 'kw' ? 0 : 1
  const bodyRef = useRef<HTMLDivElement>(null)
  const { dx, animating, targetDir, trackProps } = useCarousel({
    containerRef: bodyRef,
    hasPrev: activeIndex > 0,
    hasNext: activeIndex < 1,
    onPrev: () => setTab('kw'),
    onNext: () => setTab('ref'),
    resetKey: tab,
    enabled: isMobile,
  })
  // Light the tab the swipe is heading to as soon as it passes the threshold.
  const visualTab: LookupTab = targetDir === 'prev' ? 'kw' : targetDir === 'next' ? 'ref' : tab

  // On the mobile drawer, auto-focus the active tab's textarea when its
  // input is empty so the soft keyboard opens immediately — saves a tap when
  // the user pulls up the panel intending to type. Skipped on desktop where
  // explicit focus is the user's call. iOS Safari may still refuse to open
  // the keyboard if the focus call doesn't happen during a user gesture;
  // the cursor lands in the field regardless.
  useEffect(() => {
    if (!isMobile) return
    const value = tab === 'ref' ? q : kw
    if (value !== '') return
    const ta = tab === 'ref' ? textareaRef.current : kwTextareaRef.current
    ta?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, tab])

  // Keep the highlight backdrop scrolled in lock-step with the textarea. On
  // mobile both tab panels are mounted (carousel), on desktop only the active
  // one — either way this attaches once the ref textarea / backdrop exist.
  useEffect(() => {
    const ta = textareaRef.current
    const bd = backdropRef.current
    if (!ta || !bd) return
    const sync = () => {
      bd.scrollTop = ta.scrollTop
      bd.scrollLeft = ta.scrollLeft
    }
    sync() // catch any initial offset
    ta.addEventListener('scroll', sync, { passive: true })
    return () => ta.removeEventListener('scroll', sync)
  }, [tab, isMobile])

  // Grow the fields to fit their text — on every value change, which covers
  // typing, paste and clear alike. Backdrop follows via the shell it shares.
  useEffect(() => {
    autoGrow(kwTextareaRef.current)
  }, [kw])
  useEffect(() => {
    autoGrow(textareaRef.current)
  }, [q])

  const resolvedRefs = useMemo(
    () => resolveRefs(refs, { bible: data, bibleEn, annotations, showEnglish }),
    [refs, data, bibleEn, annotations, showEnglish],
  )

  const resolvedKw = useMemo(
    () => searchKeyword(kw, { bible: data, bibleEn, annotations, showEnglish }, KW_RESULT_CAP),
    [kw, data, bibleEn, annotations, showEnglish],
  )

  const resolved = tab === 'ref' ? resolvedRefs : resolvedKw.rows

  // Per-ref: did it resolve to at least one real verse? (parsed but not found → error)
  const refFound = useMemo(() => refsExist(refs, data), [refs, data])

  // Which citation in the input the mouse is over, and the rows it produced.
  // The backdrop is behind the textarea and can't be hovered, so the pointer is
  // tested against the boxes those spans occupy — they sit glyph-for-glyph over
  // the text, which is what makes that reliable.
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null)
  const groupRefRange = useMemo(() => {
    const ranges: [number, number][] = []
    const startOf: number[] = []
    let cursor = 0
    for (const seg of segments) {
      startOf.push(cursor)
      cursor += seg.refs?.length ?? 0
    }
    for (const g of groupRefs(segments)) {
      const last = segments[g.to]
      ranges.push([startOf[g.from], startOf[g.to] + (last.refs?.length ?? 0)])
    }
    return ranges
  }, [segments])

  const onBackdropHover = (e: React.MouseEvent) => {
    const bd = backdropRef.current
    if (!bd) return
    const { clientX: x, clientY: y } = e
    for (const el of bd.querySelectorAll<HTMLElement>('[data-group]')) {
      for (const r of el.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          setHoveredGroup(Number(el.dataset.group))
          return
        }
      }
    }
    setHoveredGroup(null)
  }

  // The block of rows one citation produced. Hovering the citation in the input
  // or any row it produced lights all of them: they are one answer, and the
  // rows sit flush against each other so the tint reads as a single block.
  const litRefRange = useMemo(() => {
    if (hoveredGroup != null) return groupRefRange[hoveredGroup] ?? null
    const from = hovered != null ? resolvedRefs[hovered]?.refIndex : undefined
    if (from == null) return null
    return groupRefRange.find(([a, b]) => from >= a && from < b) ?? null
  }, [hoveredGroup, groupRefRange, hovered, resolvedRefs])

  // Key of the result row currently under the mouse — so its source token in
  // the input backdrop highlights along with the row's own lit state.
  const hoveredRow = hovered != null ? resolved[hovered] : null
  const hoveredVerse = hoveredRow
    ? { bookNo: hoveredRow.bookNo, chapter: hoveredRow.chapterNo, verse: hoveredRow.verse.verse }
    : null

  // Stable so the memoized ResultList isn't re-rendered every swipe frame.
  const openRef = useCallback(
    (r: ResolvedVerse) => {
      // Jumping to a verse in the chapter already on screen: suppress the
      // router's scroll-to-top so ChapterView glides straight to the target
      // instead of bouncing off the top first. Cross-chapter keeps the default
      // reset — the content fully changes there.
      const sameChapter = r.bookNo === activeBookNo && r.chapterNo === activeChapterNo
      navigate({
        to: '/$bookNo/$chapterNo',
        params: { bookNo: r.bookNo, chapterNo: r.chapterNo },
        search: { hl: refHl(r.ref) },
        resetScroll: sameChapter ? false : undefined,
      })
      // Called even when navigating to the same chapter (different verse): the
      // pathname doesn't change so the drawer's pathname-effect wouldn't fire.
      onNavigate?.()
    },
    [activeBookNo, activeChapterNo, navigate, onNavigate],
  )
  const onHover = useCallback((i: number, h: boolean) => setHovered(h ? i : null), [])

  // Multi-select: long-press a result to start, then tap toggles instead of
  // navigating. Indices into the active tab's result list; reset on tab change
  // or query edit (so stale indices never linger).
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const selecting = selected.size > 0
  const toggleSel = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])
  const clearSel = useCallback(() => setSelected(new Set()), [])
  // Reset the selection when the active tab or its query changes — stale indices
  // would point at the wrong rows. Done during render (React's "adjust state when
  // an input changes" pattern), not an effect.
  const selScope = `${tab}\u0000${tab === 'kw' ? kw : q}`
  const [prevSelScope, setPrevSelScope] = useState(selScope)
  if (prevSelScope !== selScope) {
    setPrevSelScope(selScope)
    setSelected(new Set())
  }

  // Tokens the keyword search highlights inside its result rows — always derived
  // from kw because the keyword panel is mounted even while the 經節 tab is
  // active (carousel). The ref panel passes [] so its rows use the mark renderer.
  const kwTokens = useMemo(
    () => kw.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [kw],
  )

  // The 經節 field: the highlight backdrop laid under a transparent textarea,
  // both on FIELD_INPUT so the coloured refs sit exactly under the caret. Two
  // lines tall to start (min-h-[4.5rem]) so its example placeholder shows whole.
  const refInput = (
    <div className="flex flex-col gap-3">
      <div className={FIELD_SHELL}>
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(FIELD_INPUT, 'pointer-events-none absolute inset-0 text-foreground')}
        >
          {renderBackdrop(segments, refFound, activeKey, hoveredVerse, hoveredGroup)}
        </div>
        <Textarea
          ref={textareaRef}
          value={q}
          onMouseMove={onBackdropHover}
          onMouseLeave={() => setHoveredGroup(null)}
          onChange={(e) => setQ(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={1}
          spellCheck={false}
          data-vaul-no-drag
          className={cn(FIELD_INPUT, 'relative min-h-[4.5rem] text-transparent caret-foreground')}
        />
      </div>
      <InputActions value={q} onChange={setQ} focusRef={textareaRef} scan variant="bar" />
    </div>
  )

  const kwInput = (
    <div className="flex flex-col gap-3">
      <div className={FIELD_SHELL}>
        <Textarea
          ref={kwTextareaRef}
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜尋關鍵字（空白分隔多詞）"
          rows={1}
          spellCheck={false}
          data-vaul-no-drag
          className={FIELD_INPUT}
        />
      </div>
      <InputActions value={kw} onChange={setKw} focusRef={kwTextareaRef} variant="bar" />
    </div>
  )

  const kwPanel = (
    <SearchTabPanel
      input={kwInput}
      resolved={resolvedKw.rows}
      total={resolvedKw.total}
      selected={tab === 'kw' ? selected : EMPTY_SELECTION}
      onClear={clearSel}
      scrollKey={`lookup:kw:${kw}`}
    >
      <ResultList
        rows={resolvedKw.rows}
        tokens={kwTokens}
        error={error}
        loading={!data}
        isEmpty={kw.trim() === ''}
        hint=""
        activeBookNo={activeBookNo}
        activeChapterNo={activeChapterNo}
        activeHl={activeHl}
        hovered={hovered}
        selected={tab === 'kw' ? selected : EMPTY_SELECTION}
        selecting={tab === 'kw' && selecting}
        onHover={onHover}
        onOpen={openRef}
        onToggle={tab === 'kw' ? toggleSel : noop}
      />
    </SearchTabPanel>
  )
  const refPanel = (
    <SearchTabPanel
      input={refInput}
      resolved={resolvedRefs}
      total={resolvedRefs.length}
      selected={tab === 'ref' ? selected : EMPTY_SELECTION}
      onClear={clearSel}
      scrollKey={`lookup:ref:${q}`}
    >
      <ResultList
        rows={resolvedRefs}
        fromHoveredRef={litRefRange}
        tokens={NO_TOKENS}
        error={error}
        loading={!data}
        isEmpty={q.trim() === ''}
        hint=""
        activeBookNo={activeBookNo}
        activeChapterNo={activeChapterNo}
        activeHl={activeHl}
        hovered={hovered}
        selected={tab === 'ref' ? selected : EMPTY_SELECTION}
        selecting={tab === 'ref' && selecting}
        onHover={onHover}
        onOpen={openRef}
        onToggle={tab === 'ref' ? toggleSel : noop}
      />
    </SearchTabPanel>
  )

  return (
    <div className="flex h-full flex-col">
      {/* A segmented pill at the top — no separate title strip, on either
       * viewport. visualTab tracks the swipe so the active tab flips the moment
       * a drag crosses the threshold (mobile only; desktop has no swipe). */}
      <div className="mx-4 mt-3 mb-3 flex overflow-hidden rounded-xl border border-border bg-muted">
        <SegTab active={visualTab === 'kw'} onClick={() => setTab('kw')}>關鍵字</SegTab>
        <span aria-hidden className="w-px self-stretch bg-border" />
        <SegTab active={visualTab === 'ref'} onClick={() => setTab('ref')}>經節</SegTab>
      </div>

      {isMobile ? (
        // Mobile: both tabs ride a 200%-wide track; the gesture hook slides dx
        // and a release snaps to the nearer tab. touch-pan-y lets vertical
        // scrolling through while the hook locks + owns horizontal drags.
        <div
          ref={bodyRef}
          {...trackProps}
          className="relative min-h-0 flex-1 touch-pan-y overflow-hidden"
        >
          <div
            className="flex h-full"
            style={{
              transform: `translateX(calc(${-activeIndex * 100}% + ${dx}px))`,
              transition: animating ? 'transform 250ms ease-out' : undefined,
            }}
          >
            <div className="h-full w-full shrink-0">{kwPanel}</div>
            {/* A rule between the two panels, shown as you swipe across — like
              * the book/chapter divider in the catalog. */}
            <div className="h-full w-full shrink-0 border-l border-border">{refPanel}</div>
          </div>
        </div>
      ) : (
        // Desktop: no swipe — render only the active tab's panel.
        <div className="min-h-0 flex-1">{tab === 'kw' ? kwPanel : refPanel}</div>
      )}
    </div>
  )
}

/** One tab's surface: a fixed input header, a scrollable results body, and the
 * copy bar stuck to the bottom (floats over the results while scrolling, sinks
 * to the bottom when they're short). */
function SearchTabPanel({
  input,
  children,
  resolved,
  total,
  selected,
  onClear,
  scrollKey,
}: {
  input: ReactNode
  children: ReactNode
  resolved: ResolvedVerse[]
  total: number
  selected: ReadonlySet<number>
  onClear: () => void
  /** Remembers this tab's scroll under this key, so leaving the phone's /search
   * page into a verse and coming back lands where the reader left the list.
   * Carries the query so a new search starts at the top, not at the old offset;
   * the two tabs pass different keys so both survive being mounted at once. */
  scrollKey: string
}) {
  return (
    <div className="flex h-full flex-col">
      {/* The field carries its own border and the actions sit under it as a
       * plain row, an even 12px between each. A bottom rule separates the whole
       * input area from the results below. */}
      <div className="border-b border-border px-4 pb-3">{input}</div>
      {/* pb-0 drops ScrollBody's own nav-height padding: the /search wrapper
       * already holds the whole panel above the bottom nav, so the copy bar's
       * sticky bottom stays measured from the visible edge as it was in the
       * drawer. */}
      <ScrollBody restoreKey={scrollKey} className="min-h-0 flex-1 pb-0">
        {/* min-h-full + a flex-1 content row pushes the sticky copy bar to the
         * bottom even when the results don't fill the pane. */}
        <div className="flex min-h-full flex-col">
          <div className="flex-1 p-4">{children}</div>
          <CopyAllBar resolved={resolved} total={total} selected={selected} onClear={onClear} />
        </div>
      </ScrollBody>
    </div>
  )
}

function ResultRow({
  resolved,
  highlightTokens: hlTokens,
  active,
  hover,
  selected,
  selecting,
  onHover,
  onOpen,
  onToggle,
}: {
  resolved: ResolvedVerse
  /** Lowercased query tokens — when non-empty, verse / English text in the
   * row gets a keyword-highlight overlay instead of the marks-based renderer.
   * Empty array on the ref tab. */
  highlightTokens: string[]
  active: boolean
  hover: boolean
  selected: boolean
  selecting: boolean
  onHover: (hovering: boolean) => void
  onOpen: () => void
  onToggle: () => void
}) {
  const isMobile = useIsMobile()
  const pressTimerRef = useRef<number | null>(null)
  const longPressedRef = useRef(false)

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }, [])
  useEffect(() => () => clearPressTimer(), [clearPressTimer])

  const { bookNo, chapterNo, verse, enText, noteToShow, noteOnly } = resolved
  const abbrev = BOOK_ABBREV[bookNo] ?? ''
  // Direct-note rows tag the label with the note number — 「啟21:23註1」 — so
  // the left column matches what the user typed in the input.
  const label =
    noteOnly && noteToShow
      ? `${abbrev}${chapterNo}:${verse.verse}註${noteToShow.n}`
      : `${abbrev}${chapterNo}:${verse.verse}`
  const lit = active || hover

  const handlers = {
    // A long-press already toggled selection; swallow the click that follows.
    onClick: () => {
      if (longPressedRef.current) {
        longPressedRef.current = false
        return
      }
      if (selecting) onToggle()
      else onOpen()
    },
    onMouseEnter: () => onHover(true),
    // Mobile long-press enters selection mode + selects this row. After that a
    // tap toggles; only a tap while nothing is selected still navigates.
    onPointerDown: () => {
      if (!isMobile) return
      longPressedRef.current = false
      clearPressTimer()
      pressTimerRef.current = window.setTimeout(() => {
        longPressedRef.current = true
        onToggle()
        if ('vibrate' in navigator) navigator.vibrate(40)
      }, 500)
    },
    onPointerUp: clearPressTimer,
    onPointerCancel: clearPressTimer,
    // Cancel the long-press if the user starts scrolling rather than holding.
    onPointerMove: clearPressTimer,
  }

  return (
    <div
      {...handlers}
      // `select-none` suppresses the native blue text-selection that appears
      // under a long press; `[-webkit-touch-callout:none]` kills iOS Safari's
      // grey selection callout the same gesture triggers.
      className="col-span-2 grid cursor-pointer grid-cols-subgrid items-baseline rounded py-[0.3125rem] transition-colors select-none [-webkit-touch-callout:none]"
    >
      <span
        className={cn(
          'self-start whitespace-nowrap pt-1 text-left text-xs font-sans transition-colors',
          active && 'font-medium',
          lit ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <div className={cn(selected && 'rounded bg-blue-500/20 px-1 -mx-1 dark:bg-blue-400/25')}>
        {noteToShow ? (
          // Note row — render the note body where verse text normally goes, so a
          // note result lays out identically to a verse result.
          noteToShow.text.split('\n').map((para, i) => (
            <p
              key={i}
              className={cn('transition-colors', lit ? 'text-foreground' : 'text-foreground/90')}
            >
              {renderNoteText(para, { book: bookNo, chapter: chapterNo })}
            </p>
          ))
        ) : (
          <>
            <p className={cn('transition-colors', lit ? 'text-foreground' : 'text-foreground/90')}>
              {hlTokens.length > 0
                ? highlightTokens(verse.text, hlTokens)
                : renderMarkedText(verse.text, verse.marks)}
            </p>
            {enText && (
              // Match ChapterView's English styling so the lookup result feels
              // of-a-piece with the reading surface for the same verse.
              <p className="mt-0.5 font-sans text-[0.9em] text-muted-foreground">
                {hlTokens.length > 0 ? highlightTokens(enText, hlTokens) : enText}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Bottom action bar for the results. Copies / shares either the current
 * selection (long-press a row to start selecting) or, when nothing is selected,
 * every result. The language (中文 / 英文 / 中英文) is a setting, so 複製 / 分享 are
 * plain buttons. Same pill shell as the chapter selection bar. Returns null when
 * there's nothing. */
function CopyAllBar({
  resolved,
  total,
  selected,
  onClear,
}: {
  resolved: ResolvedVerse[]
  total: number
  selected: ReadonlySet<number>
  onClear: () => void
}) {
  const [cite] = useLocalStorage<CiteFormat>('rcv/cite-format', DEFAULT_CITE_FORMAT)
  const [pos] = useLocalStorage<CitePosition>('rcv/cite-position', DEFAULT_CITE_POSITION)
  const [copyLang] = useLocalStorage<CopyLang>('rcv/copy-lang', DEFAULT_COPY_LANG)
  const [showEnglish] = useLocalStorage('rcv/show-english', false)
  // Nothing to copy → don't float an empty pill over the (also empty) results.
  if (resolved.length === 0) return null

  // en / both only make sense with English loaded; otherwise force 中文.
  const lang: CopyLang = showEnglish ? copyLang : 'zh'
  const sep = lang === 'both' ? '\n\n' : '\n'
  const selecting = selected.size > 0
  const target = selecting ? resolved.filter((_, i) => selected.has(i)) : resolved
  const text = () => target.map((r) => formatCopyText(r, lang, cite, pos)).filter(Boolean).join(sep)

  const copy = async () => {
    const t = text()
    if (!t) return
    try { await navigator.clipboard.writeText(t) } catch { /* denied */ }
    onClear()
  }
  const share = async () => {
    const t = text()
    if (!t) return
    try {
      if (navigator.share) await navigator.share({ text: t })
      else await navigator.clipboard.writeText(t)
      onClear()
    } catch {
      /* share sheet dismissed — keep the selection */
    }
  }

  return (
    <div
      className={cn(
        'sticky bottom-3 z-10 mx-3 mt-2 mb-3 flex h-14 shrink-0 items-center gap-3 px-4 pr-2.5 text-sm',
        ACTION_BAR_CLS,
      )}
    >
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {selecting
          ? `選取 ${selected.size} 節`
          : total > resolved.length
            ? `共 ${total} 節（顯示前 ${resolved.length}）`
            : `共 ${total} 節`}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={share}
          className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95"
        >
          分享
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95"
        >
          複製
        </button>
        {selecting && (
          <button
            type="button"
            onClick={onClear}
            aria-label="取消選取"
            className="rounded-lg px-2 py-2 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95"
          >
            <X className="size-4.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** One segment of the phone's tab control: the active half fills with the page
 * background (clipped to the container's rounded corners), the inactive half
 * stays on the muted track. */
function SegTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 py-2 text-center text-sm transition-colors',
        active ? 'bg-background font-semibold text-primary' : 'font-medium text-muted-foreground',
      )}
    >
      {children}
    </button>
  )
}
