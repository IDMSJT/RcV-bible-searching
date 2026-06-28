import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { parseRefs, type Segment, type VerseRef } from '@/lib/parseRefs'
import {
  useBible,
  useBibleEn,
  useAnnotations,
  findChapter,
  findAnnotationChapter,
  eachVerseInRange,
} from '@/data/loadBible'
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
import { cn } from '@/lib/utils'
import type { Annotation, Verse } from '@/types/bible'

// Shared text/padding rules so the visible Textarea above the highlight-aware
// backdrop renders glyphs at exactly the same positions. text-base on mobile
// (iOS Safari's focus-zoom only kicks in below 16px), md:text-sm on desktop
// to match the rest of the sidebar panels.
const FIELD_CLS = 'p-4 font-serif text-base leading-relaxed md:text-sm'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-[var(--header-h)] shrink-0 items-center justify-center border-b border-border bg-muted/80 px-4 text-base font-medium backdrop-blur md:h-9 md:justify-start md:text-xs md:font-semibold'

const PLACEHOLDER =
  '輸入經文出處，例如：\n約翰福音一章一節，三章十六節，十四章六節'

interface ResolvedVerse {
  bookNo: number
  chapterNo: number
  verse: Verse
  /** English translation, when 顯示英文 is on and the English bible has the
   * matching verse. Stored as a plain string because the English DB doesn't
   * carry the same marks / segment structure. */
  enText?: string
  /** Single note attached to the ref via 注N / 註N suffix.
   *
   * - With a connector (與註1, ，註1) the verse is the row's main content and
   *   the note renders inline below it.
   * - Without a connector (啟二一23註1) the row is "note-only": the verse
   *   text is suppressed and the right column shows just the note body, with
   *   the label extended to 「<verse>註<N>」. */
  noteToShow?: Annotation
  /** True for the direct-attach form (no connector before 注N). Drives the
   * note-only display + the `${verse}:${n}` hl URL form. */
  noteOnly?: boolean
  ref: VerseRef
}

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

function renderBackdrop(
  segments: Segment[],
  refFound: boolean[],
  activeKey: string | null,
  hoveredKey: string | null,
) {
  // Segments are emitted in input order; ref segments carry the resolved
  // VerseRefs while everything else (prose, separators) renders plain. We
  // walk a flat `refFound` cursor that's keyed to the same VerseRef order
  // as the results list, so a segment with multiple refs (a 創一1、5 token
  // that yields two refs) consumes that many slots.
  let refIndex = 0
  return segments.map((seg, i) => {
    if (!seg.refs || seg.refs.length === 0) {
      return <Fragment key={i}>{seg.text}</Fragment>
    }
    const startIdx = refIndex
    refIndex += seg.refs.length
    let allResolved = true
    let lit = false
    for (let j = 0; j < seg.refs.length; j++) {
      if (refFound[startIdx + j] === false) allResolved = false
      const ref = seg.refs[j]
      const key = refKey(ref.bookNo, ref.chapter, refHl(ref))
      if (key === activeKey || key === hoveredKey) lit = true
    }
    if (!allResolved) {
      return (
        <span key={i} className="rounded-sm bg-destructive/15 text-destructive">
          {seg.text}
        </span>
      )
    }
    return lit ? (
      <span key={i} className="rounded-sm bg-highlight">
        {seg.text}
      </span>
    ) : (
      <Fragment key={i}>{seg.text}</Fragment>
    )
  })
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
  const pattern = sorted
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const re = new RegExp(`(${pattern})`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <mark key={`k${key++}`} className="rounded-sm bg-highlight text-inherit">
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
}: {
  rows: ResolvedVerse[]
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
  if (error) return <p className="text-sm text-destructive">資料載入失敗：{error}</p>
  if (isEmpty) return <p className="text-sm text-muted-foreground">{hint}</p>
  if (loading) return <p className="text-sm text-muted-foreground">載入中…</p>
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">找不到符合的經節</p>
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2.5 font-serif text-[length:var(--reading-fs,1rem)] leading-normal md:text-[length:calc(var(--reading-fs,1rem)*0.9375)]">
      {rows.map((r, i) => {
        const active =
          activeBookNo === r.bookNo && activeChapterNo === r.chapterNo && activeHl === refHl(r.ref)
        return (
          <ResultRow
            key={`${r.bookNo}-${r.chapterNo}-${r.verse.verse}-${i}`}
            resolved={r}
            highlightTokens={tokens}
            active={active}
            hover={hovered === i}
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

  const resolvedRefs = useMemo<ResolvedVerse[]>(() => {
    if (!data) return []
    const out: ResolvedVerse[] = []
    for (const ref of refs) {
      // A note only attaches to a single verse in one chapter — a range or a
      // cross-chapter span can't say which verse the 「注N」 belongs to.
      const wantsNote =
        ref.note != null && ref.verseStart === ref.verseEnd && ref.chapter === ref.endChapter
      const annChapter = wantsNote ? findAnnotationChapter(annotations, ref.bookNo, ref.chapter) : null

      // Walk every verse the ref covers — spans chapters for a cross-chapter
      // range. English / annotation lookups key off each verse's REAL chapter
      // (vCh), not the ref's start chapter.
      for (const { chapterNo: vCh, verse: v } of eachVerseInRange(
        data,
        ref.bookNo,
        ref.chapter,
        ref.endChapter,
        ref.verseStart,
        ref.verseEnd,
      )) {
        // Bare 註 (noteAll): every footnote on this verse becomes its own
        // note-only row. Each row carries a synthesised single-note ref so the
        // existing refHl / navigation / backdrop machinery works unchanged.
        // Connected form (太八2與註) also emits the verse row first.
        if (ref.noteAll) {
          const vNotes =
            findAnnotationChapter(annotations, ref.bookNo, vCh)?.verses.find(
              (x) => x.verse === v.verse,
            )?.notes ?? []
          if (!ref.noteDirect) {
            const enText = showEnglish
              ? findChapter(bibleEn, ref.bookNo, vCh)?.verses.find((x) => x.verse === v.verse)?.text
              : undefined
            out.push({ bookNo: ref.bookNo, chapterNo: vCh, verse: v, enText, ref: { ...ref, noteAll: undefined } })
          }
          for (const note of vNotes) {
            out.push({
              bookNo: ref.bookNo,
              chapterNo: vCh,
              verse: v,
              noteToShow: note,
              noteOnly: true,
              ref: { ...ref, noteAll: undefined, note: note.n, noteDirect: true },
            })
          }
          continue
        }

        const isAttachedVerse = wantsNote && vCh === ref.chapter && v.verse === ref.verseStart
        const noteToShow = isAttachedVerse
          ? annChapter?.verses.find((x) => x.verse === v.verse)?.notes.find((n) => n.n === ref.note)
          : undefined

        // Direct 注N (啟二一23註1) → ONE note-only row in place of the
        // verse. Drop it entirely when the note doesn't exist (typo / OOR N).
        if (isAttachedVerse && ref.noteDirect) {
          if (!noteToShow) continue
          out.push({ bookNo: ref.bookNo, chapterNo: vCh, verse: v, noteToShow, noteOnly: true, ref })
          continue
        }

        // Otherwise emit the verse row.
        const enText = showEnglish
          ? findChapter(bibleEn, ref.bookNo, vCh)?.verses.find((x) => x.verse === v.verse)?.text
          : undefined
        out.push({ bookNo: ref.bookNo, chapterNo: vCh, verse: v, enText, ref })

        // Connected 注N (啟二一23與註1) → ALSO add a separate note-only row
        // right after the verse, so the user sees both targets as distinct
        // results.
        if (isAttachedVerse && !ref.noteDirect && noteToShow) {
          out.push({ bookNo: ref.bookNo, chapterNo: vCh, verse: v, noteToShow, noteOnly: true, ref })
        }
      }
    }
    return out
  }, [refs, data, bibleEn, showEnglish, annotations])

  // Keyword-search results. Same shape as ref results so the renderer / copy
  // machinery don't care which tab is active. Caps at KW_RESULT_CAP so a
  // 1-char query doesn't dump every verse into the DOM at once.
  const resolvedKw = useMemo<ResolvedVerse[]>(() => {
    const query = kw.trim()
    if (!data || !query) return []
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return []
    const out: ResolvedVerse[] = []
    outer: for (const book of data.books) {
      for (const chapter of book.chapters) {
        const enChapter = showEnglish ? findChapter(bibleEn, book.bookNo, chapter.chapterNo) : null
        for (const v of chapter.verses) {
          const haystackZh = v.text
          const haystackEn = enChapter?.verses.find((x) => x.verse === v.verse)?.text ?? ''
          // Each token must appear in either zh or en — gives a forgiving
          // mixed-language search without needing a language toggle.
          const matched = tokens.every(
            (t) => haystackZh.includes(t) || haystackEn.toLowerCase().includes(t),
          )
          if (!matched) continue
          out.push({
            bookNo: book.bookNo,
            chapterNo: chapter.chapterNo,
            verse: v,
            enText: haystackEn || undefined,
            ref: {
              bookNo: book.bookNo,
              chapter: chapter.chapterNo,
              endChapter: chapter.chapterNo,
              verseStart: v.verse,
              verseEnd: v.verse,
              seg: null,
              source: '',
            },
          })
          if (out.length >= KW_RESULT_CAP) break outer
        }
      }
    }
    return out
  }, [kw, data, bibleEn, showEnglish])

  const resolved = tab === 'ref' ? resolvedRefs : resolvedKw

  // Per-ref: did it resolve to at least one real verse? (parsed but not found → error)
  const refFound = useMemo<boolean[]>(() => {
    if (!data) return refs.map(() => true)
    // Resolved iff at least one real verse falls in the (possibly
    // cross-chapter) span — mirror the result-row expansion so a valid
    // 十一27～十二37 doesn't render red just because its end verse exceeds
    // the start chapter.
    return refs.map((ref) => {
      for (const _ of eachVerseInRange(
        data,
        ref.bookNo,
        ref.chapter,
        ref.endChapter,
        ref.verseStart,
        ref.verseEnd,
      )) {
        void _
        return true
      }
      return false
    })
  }, [refs, data])

  // Key of the result row currently under the mouse — so its source token in
  // the input backdrop highlights along with the row's own lit state.
  const hoveredRef = hovered != null ? resolved[hovered]?.ref : null
  const hoveredKey = hoveredRef != null
    ? refKey(hoveredRef.bookNo, hoveredRef.chapter, refHl(hoveredRef))
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
  const selScope = `${tab} ${tab === 'kw' ? kw : q}`
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

  const refInput = (
    <div className="relative">
      {/* Backdrop: same text, failed tokens in red */}
      <div
        ref={backdropRef}
        aria-hidden
        className={cn(
          FIELD_CLS,
          'pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words text-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {renderBackdrop(segments, refFound, activeKey, hoveredKey)}
      </div>
      <Textarea
        ref={textareaRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        // Edit surface owns its touches; don't fight the drawer / swipe drag.
        data-vaul-no-drag
        className={cn(
          FIELD_CLS,
          'relative block h-[120px] w-full resize-none break-words border-0 bg-transparent text-transparent caret-foreground shadow-none focus-visible:ring-0 [field-sizing:fixed]',
        )}
      />
      <InputActions value={q} onChange={setQ} focusRef={textareaRef} />
    </div>
  )

  const kwInput = (
    <div className="relative">
      <Textarea
        ref={kwTextareaRef}
        value={kw}
        onChange={(e) => setKw(e.target.value)}
        placeholder="搜尋關鍵字…（中英文皆可、空白分隔多詞）"
        spellCheck={false}
        data-vaul-no-drag
        className={cn(
          FIELD_CLS,
          'relative block h-[120px] w-full resize-none break-words border-0 bg-transparent shadow-none focus-visible:ring-0 [field-sizing:fixed]',
        )}
      />
      <InputActions value={kw} onChange={setKw} focusRef={kwTextareaRef} />
    </div>
  )

  const kwPanel = (
    <SearchTabPanel
      input={kwInput}
      resolved={resolvedKw}
      selected={tab === 'kw' ? selected : EMPTY_SELECTION}
      onClear={clearSel}
    >
      <ResultList
        rows={resolvedKw}
        tokens={kwTokens}
        error={error}
        loading={!data}
        isEmpty={kw.trim() === ''}
        hint="輸入關鍵字搜尋（中英文皆可，以空白分隔多個詞）"
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
      selected={tab === 'ref' ? selected : EMPTY_SELECTION}
      onClear={clearSel}
    >
      <ResultList
        rows={resolvedRefs}
        tokens={NO_TOKENS}
        error={error}
        loading={!data}
        isEmpty={q.trim() === ''}
        hint="輸入經文出處以查詢"
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
      {/* Tabs stretch full header height (items-stretch) and have no outer
       * padding so the hover/active bg fills cleanly to the edges — mirrors
       * the 綱目 link style on the chapter header. visualTab tracks the swipe so
       * the highlight flips the moment a drag passes the threshold. */}
      <h2 className={cn(HEADER_CLS, 'items-stretch px-0 md:px-1.5')}>
        <TabBtn active={visualTab === 'kw'} onClick={() => setTab('kw')}>關鍵字</TabBtn>
        <TabBtn active={visualTab === 'ref'} onClick={() => setTab('ref')}>經節</TabBtn>
      </h2>

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
            <div className="h-full w-full shrink-0">{refPanel}</div>
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
  selected,
  onClear,
}: {
  input: ReactNode
  children: ReactNode
  resolved: ResolvedVerse[]
  selected: ReadonlySet<number>
  onClear: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-background">{input}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* min-h-full + a flex-1 content row pushes the sticky copy bar to the
         * bottom even when the results don't fill the pane. */}
        <div className="flex min-h-full flex-col">
          <div className="flex-1 p-4">{children}</div>
          <CopyAllBar resolved={resolved} selected={selected} onClear={onClear} />
        </div>
      </div>
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
    onMouseLeave: () => onHover(false),
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
      className="col-span-2 grid cursor-pointer grid-cols-subgrid items-baseline rounded transition-colors select-none [-webkit-touch-callout:none]"
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
      <div className={cn(selected && 'rounded bg-blue-500/15 px-1 -mx-1 dark:bg-blue-400/20')}>
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
  selected,
  onClear,
}: {
  resolved: ResolvedVerse[]
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
    <div className="sticky bottom-3 z-10 mx-3 mt-2 mb-3 flex h-14 shrink-0 items-center gap-3 rounded-xl border border-border bg-popover/95 px-4 pr-2.5 text-sm shadow-lg backdrop-blur">
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {selecting ? `選取 ${selected.size} 節` : `共 ${resolved.length} 節`}
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

function TabBtn({
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
        // Full-height rectangle (parent uses items-stretch) with px inside
        // so the hover bg reaches the top / bottom of the header strip — same
        // treatment as the 綱目 link on the chapter header. Desktop tightens
        // to px-2.5 so adjacent tabs sit close together instead of the
        // mobile-spaced 1rem-each-side that reads as a wide gap on md+.
        'inline-flex items-center px-4 transition-colors md:px-2.5',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
