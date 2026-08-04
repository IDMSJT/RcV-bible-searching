import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import {
  useBible,
  useBibleEn,
  useOutline,
  useAnnotations,
  useCrossRefs,
  findChapter,
  notesForVerse,
  crossRefsForVerse,
  chapterOutlineByAnchor,
} from '@/data/loadBible'
import { BOOK_BY_NO } from '@/data/canon'
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
import {
  renderMarkedText,
  sliceMarks,
  CardList,
  NoteCard,
  CrossRefCard,
  type MarkersAt,
} from '@/lib/renderVerse'
import { emptyOpenState, parseOpen, serializeOpen, type OpenState } from '@/lib/openState'
import type { Open } from '@/lib/renderVerse'
import { OutlineLabel } from '@/components/OutlineLabel'
import type { HlItem } from '@/lib/highlight'
import { revealInScroll } from '@/lib/revealInScroll'
import { useIsTouch } from '@/lib/useIsTouch'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import type { Annotation, CrossRef, Mark, OutlineEntry } from '@/types/bible'

/** Footnotes whose anchors fall in [start, end), re-based to that slice. A note
 * anchored in more than one place keeps only the anchors inside the slice. */
function sliceNotes(notes: Annotation[] | undefined, start: number, end: number): Annotation[] {
  if (!notes) return []
  const out: Annotation[] = []
  for (const n of notes) {
    const offsets = n.offsets.filter((o) => o >= start && o < end).map((o) => o - start)
    if (offsets.length > 0) out.push({ ...n, offsets })
  }
  return out
}

/** Cross-refs anchored in [start, end), re-based to that slice. A marker placed
 * in more than one spot keeps only the anchors inside the slice. */
function sliceCrossRefs(refs: CrossRef[] | undefined, start: number, end: number): CrossRef[] {
  if (!refs) return []
  const out: CrossRef[] = []
  for (const r of refs) {
    const offsets = r.offsets.filter((o) => o >= start && o < end).map((o) => o - start)
    if (offsets.length > 0) out.push({ ...r, offsets })
  }
  return out
}

function OutlineHeading({
  entry,
  entryIdx,
  tight,
  highlight,
  innerRef,
  bookNo,
}: {
  entry: OutlineEntry
  entryIdx: number
  tight: boolean
  highlight?: boolean
  innerRef?: (el: HTMLElement | null) => void
  bookNo: number
}) {
  // Match the outline page's rows: the whole column is the link (block +
  // paddingLeft indent), while the hover / highlight tint sits on just the text
  // span (inline, -mx-1 so the bg bleeds without shifting layout). Tapping jumps
  // to this exact entry on the outline page (?oe=index — index, not the anchor,
  // so duplicate-anchor entries stay distinct), the reverse of the outline
  // page's ?oh= link back into the chapter.
  return (
    <Link
      ref={innerRef}
      to="/$bookNo"
      params={{ bookNo }}
      search={{ oe: String(entryIdx) }}
      style={{ paddingLeft: `${(entry.level - 1) * 0.5}rem` }}
      className={cn(
        'group col-start-2 block pr-2 font-sans text-[0.875em] text-muted-foreground transition-colors hover:text-foreground',
        !tight && 'mt-2 first:mt-0',
      )}
    >
      <OutlineLabel entry={entry} highlight={highlight} />
    </Link>
  )
}

type Row =
  | { kind: 'heading'; entry: OutlineEntry; idx: number; tight: boolean; hl: boolean; ref: boolean; key: string }
  | {
      kind: 'verse'
      /** Raw verse number, used as the toggle key for note expansion. Stays
       * set even when `num` is hidden on continuation rows of a split verse. */
      verse: number
      num: number | ''
      text: string
      /** English under the verse, only when 顯示英文 is on AND the verse number's
       * start segment (not split fragments) maps to a known English string. */
      en?: string
      marks?: Mark[]
      /** Inline footnote markers + bodies for this verse (when 顯示註釋 is on). */
      notes?: Annotation[]
      /** Cross-reference (串珠) markers for this verse (when 顯示串珠 is on). */
      refs?: CrossRef[]
      hl: boolean
      ref: boolean
      key: string
    }

/** Collapse sorted verse numbers into 「1~2」/「5」 range strings, keeping each
 * range's start verse for ordering. */
function collapseRanges(nums: number[]): { start: number; text: string }[] {
  const sorted = [...nums].sort((a, b) => a - b)
  const out: { start: number; text: string }[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push({ start: sorted[i], text: i === j ? `${sorted[i]}` : `${sorted[i]}~${sorted[j]}` })
    i = j + 1
  }
  return out
}

/** A one-line list of a selection: verses collapsed into ranges, notes as
 * 「5註1」, everything ordered by verse (verse before its note). e.g. 「1~2，5，5註1」 */
function summarizeSelection(verseSet: Set<number>, noteSet: Set<string>): string {
  const entries: { v: number; note: number; text: string }[] = []
  for (const r of collapseRanges([...verseSet])) {
    entries.push({ v: r.start, note: 0, text: r.text })
  }
  for (const key of noteSet) {
    const [v, n] = key.split(':').map(Number)
    entries.push({ v, note: 1, text: `${v}註${n}` })
  }
  entries.sort((a, b) => a.v - b.v || a.note - b.note)
  return entries.map((e) => e.text).join('，')
}

/** The most markers the corpus puts at one position, and so the most cards one
 * tap can open. Anything above this is the reader expanding the chapter, or a
 * link arriving with a set of its own, and there is nowhere single to go. */
const MOST_AT_ONE_POSITION = 4

/**
 * Bring into view whatever a tap on a marker just opened.
 *
 * Only when it isn't already there: a card that opened in plain sight must not
 * make the page jump. One taller than the panel is aligned to the top rather
 * than the bottom, so it starts where it will be read from.
 *
 * Notes and cross-references are watched together rather than one hook each.
 * A marker written 「1ab」 opens both kinds at once, and two effects would each
 * scroll to their own card; taken together they are one block to land on.
 *
 * What opened is read from the change in the sets rather than reported by the
 * tap: a ref written in a callback is a ref written during render, as far as
 * the rules go, and this needs no extra signal.
 */
function useRevealOnOpen(
  panelRef: RefObject<HTMLDivElement | null>,
  notes: Set<string>,
  refs: Set<string>,
): void {
  const shown = useRef({ notes, refs })
  useLayoutEffect(() => {
    const before = shown.current
    shown.current = { notes, refs }
    const opened = [
      ...[...notes].filter((k) => !before.notes.has(k)).map((k) => `[data-note="${k}"]`),
      ...[...refs].filter((k) => !before.refs.has(k)).map((k) => `[data-crossref="${k}"]`),
    ]
    if (opened.length === 0 || opened.length > MOST_AT_ONE_POSITION) return
    const panel = panelRef.current
    if (!panel) return
    const els = opened
      .map((sel) => panel.querySelector<HTMLElement>(sel))
      .filter((el): el is HTMLElement => el != null)
    revealInScroll(els)
  }, [notes, refs, panelRef])
}

export function ChapterView({
  bookNo,
  chapterNo,
  highlights = [],
  ohIndex,
  active = true,
  onSelectingChange,
  onScrubApi,
}: {
  bookNo: number
  chapterNo: number
  /** Combined highlight list — verses to tint and / or notes to expand+tint. */
  highlights?: HlItem[]
  /** Index (in the book outline) of the heading to scroll to + tint — from a
   * ?oh= link on the outline page. Index, not anchor, so two entries sharing a
   * verse target only the clicked one. */
  ohIndex?: number
  /** Carousel panels render three chapters; only the centred (active) one
   * responds to verse taps, shows the selection bar, and runs the oh-scroll. */
  active?: boolean
  /** Reports whether the active panel has a verse selection, so the pager can
   * pause the swipe gesture while selecting. */
  onSelectingChange?: (selecting: boolean) => void
  /** Hands the pager a way to jump this panel to a verse — the rail lives up
   * there so it can flip to the next chapter mid-swipe, but only this panel
   * knows its own scroll container. */
  onScrubApi?: (scrub: ((verse: number) => void) | null) => void
}) {
  const { data, error } = useBible()
  const { data: outline } = useOutline()
  const [showOutline] = useLocalStorage('rcv/show-outline', true)
  const [showEnglish] = useLocalStorage('rcv/show-english', false)
  const [showNotes] = useLocalStorage('rcv/show-notes', true)
  const [showRefs] = useLocalStorage('rcv/show-crossrefs', true)
  const [citeFormat] = useLocalStorage<CiteFormat>('rcv/cite-format', DEFAULT_CITE_FORMAT)
  const [citePosition] = useLocalStorage<CitePosition>('rcv/cite-position', DEFAULT_CITE_POSITION)
  const [copyLang] = useLocalStorage<CopyLang>('rcv/copy-lang', DEFAULT_COPY_LANG)
  const { data: bibleEn } = useBibleEn(showEnglish)
  const { data: annotations } = useAnnotations(showNotes)
  const { data: crossRefs } = useCrossRefs(showRefs)
  const enChapter = showEnglish ? findChapter(bibleEn, bookNo, chapterNo) : null
  const chapter = findChapter(data, bookNo, chapterNo)
  // annotations.json is a flat `book.chapter.verse` map, so gather this
  // chapter's notes once (keyed by verse) instead of re-looking-up per row.
  const chapterNotes = useMemo(() => {
    const m = new Map<number, Annotation[]>()
    if (!showNotes || !annotations || !chapter) return m
    for (const v of chapter.verses) {
      const notes = notesForVerse(annotations, bookNo, chapterNo, v.verse)
      if (notes.length) m.set(v.verse, notes)
    }
    return m
  }, [showNotes, annotations, chapter, bookNo, chapterNo])
  const chapterRefs = useMemo(() => {
    const m = new Map<number, CrossRef[]>()
    if (!showRefs || !crossRefs || !chapter) return m
    for (const v of chapter.verses) {
      const refs = crossRefsForVerse(crossRefs, bookNo, chapterNo, v.verse)
      if (refs.length) m.set(v.verse, refs)
    }
    return m
  }, [showRefs, crossRefs, chapter, bookNo, chapterNo])
  // Click-to-expand state — each entry is keyed `${verse}:${noteN}`. Lives in
  // local state because reading-position is ephemeral; navigating away should
  // collapse everything.
  // Pre-compute highlight lookup sets / ranges from the hl URL list, used
  // both to tint verses & notes and to seed the expanded-notes set so a
  // direct link like 「?hl=13,13:1」 lands with the body already open.
  // Verse-tint ranges for THIS chapter. Plain 'verse' items pass through;
  // 'crange' (cross-chapter) items are clipped to the slice that falls inside
  // the chapter being viewed — start chapter highlights startV→end, middle
  // chapters highlight the whole thing, end chapter highlights 1→endV.
  // Infinity as the upper bound just means "to the last verse" (the consumer
  // only does `v.verse <= end`).
  const verseRanges = useMemo(() => {
    const out: { start: number; end: number }[] = []
    for (const h of highlights) {
      if (h.kind === 'verse') {
        out.push({ start: h.start, end: h.end })
      } else if (h.kind === 'crange') {
        if (chapterNo < h.startCh || chapterNo > h.endCh) continue
        out.push({
          start: chapterNo === h.startCh ? h.startV : 1,
          end: chapterNo === h.endCh ? h.endV : Infinity,
        })
      }
    }
    return out
  }, [highlights, chapterNo])
  const noteHighlights = useMemo(() => {
    const s = new Set<string>()
    for (const h of highlights) {
      if (h.kind === 'note') {
        s.add(`${h.verse}:${h.n}`)
      } else if (h.kind === 'noteAll') {
        // 「v:*」 — expand to every note the verse actually has.
        const vNotes = chapterNotes.get(h.verse) ?? []
        for (const n of vNotes) s.add(`${h.verse}:${n.n}`)
      }
    }
    return s
  }, [highlights, chapterNotes])

  // Persist the open-footnote set per chapter in sessionStorage so navigating
  // to a referenced verse and pressing 「back」 (or hitting refresh) returns
  // you to the same expanded state. Initial state is read synchronously from
  // storage to avoid the first-render race where a write-on-change effect
  // would clobber the saved set with the empty initial state. Highlighted
  // notes from hl are unioned in so an inbound 「?hl=…:N」 link auto-expands
  // that body.
  const openKey = `rcv/open/${bookNo}/${chapterNo}`
  // Read the whole of a chapter's open state. The cards and the citations
  // inside them share one entry each, so there is nothing to keep in step.
  const readOpen = useCallback((key: string): OpenState => {
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) return parseOpen(JSON.parse(saved))
    } catch {
      /* malformed JSON — start fresh */
    }
    return emptyOpenState()
  }, [])
  const readStorage = useCallback((key: string) => readOpen(key).notes, [readOpen])
  // Write one part back, reading the rest from what is stored rather than from
  // state: each caller knows only the part it changed, and sessionStorage is
  // synchronous, so the store itself is the one place they can all agree on.
  const persist = useCallback(
    (part: Partial<OpenState>) => {
      const next = { ...readOpen(openKey), ...part }
      const list = serializeOpen(next)
      if (list.length > 0) sessionStorage.setItem(openKey, JSON.stringify(list))
      else sessionStorage.removeItem(openKey)
    },
    [openKey, readOpen],
  )
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => {
    const initial = readOpen(`rcv/open/${bookNo}/${chapterNo}`).notes
    for (const k of noteHighlights) initial.add(k)
    return initial
  })
  // Mirror the latest set into a ref so the sync effect can read the current
  // value (and persist it) without listing expandedNotes as a dependency.
  const expandedNotesRef = useRef(expandedNotes)
  expandedNotesRef.current = expandedNotes

  // Keep `expandedNotes` in sync across navigations, AND persist hl-opened
  // notes to sessionStorage (the lazy initializer / hl-seed only put them in
  // state). Persisting means that leaving a chapter and coming back via a
  // different verse keeps the earlier hl note open — 3:2註1 stays open after
  // you later jump to 3:3註1. Two cases:
  //   - CHAPTER changed → load the new chapter's saved set + its hl notes.
  //   - same chapter, hl changed → ADD the new hl notes; don't reset, or a
  //     note opened by a prior hl (or by hand) would close.
  const initialMountRef = useRef(true)
  const prevNotesKeyRef = useRef(openKey)
  // useLayoutEffect (not useEffect) so the hl note expands BEFORE the browser
  // paints — otherwise the user sees one frame without it, then it pops in.
  useLayoutEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      prevNotesKeyRef.current = openKey
      // Persist the mount-time hl seeds so a later return restores them.
      if (noteHighlights.size > 0) persist({ notes: expandedNotesRef.current })
      return
    }
    const chapterChanged = prevNotesKeyRef.current !== openKey
    prevNotesKeyRef.current = openKey
    const base = chapterChanged ? readStorage(openKey) : new Set(expandedNotesRef.current)
    let added = false
    for (const k of noteHighlights) {
      if (!base.has(k)) {
        base.add(k)
        added = true
      }
    }
    if (chapterChanged || added) {
      setExpandedNotes(base)
      persist({ notes: base })
    }
  }, [openKey, noteHighlights, readStorage, persist])

  // Which cross-ref letters are open, keyed `${verse}:${marker}`. Persisted per
  // chapter like the notes are, so paging away and back keeps what you opened.
  // (No hl equivalent — nothing links straight to a 串珠.)
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(() => readOpen(openKey).refs)
  // Which citation is open inside each card, keyed by the card. A card holds
  // one at a time, so this is a value per card rather than a set.
  const [cites, setCites] = useState<Record<string, Open>>(() => readOpen(openKey).cites)
  const setCite = useCallback(
    (card: string, at: Open | null) => {
      setCites((prev) => {
        const next = { ...prev }
        if (at == null) delete next[card]
        else next[card] = at
        persist({ cites: next })
        return next
      })
    },
    [persist],
  )
  // A card that closes takes whatever it had open with it, so opening it again
  // starts where a first opening would. Storage drops these on its own — this
  // is the same rule applied to the copy already in hand.
  const forgetCites = useCallback((cards: string[]) => {
    setCites((prev) => {
      if (!cards.some((c) => c in prev)) return prev
      const next = { ...prev }
      for (const c of cards) delete next[c]
      return next
    })
  }, [])
  const isTouch = useIsTouch()
  const toggleRef = useCallback(
    (verse: number, m: string) => {
      setExpandedRefs((prev) => {
        const key = `${verse}:${m}`
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
          forgetCites([`r${key}`])
        } else next.add(key)
        persist({ refs: next })
        return next
      })
    },
    [persist, forgetCites],
  )

  // A marker written 「1ab」 is one button standing for everything anchored at
  // that spot, so it has two states: all of them showing, or not. Tapping when
  // some are missing brings those back rather than inverting each — from 1 and
  // b open and a closed, toggling each would have left only a open, which is
  // neither what was there nor what was asked for. The ✕ on a card is still the
  // way to put one away on its own.
  const toggleMarkers = useCallback(
    (verse: number, at: MarkersAt) => {
      const noteKeys = at.notes.map((n) => `${verse}:${n}`)
      const refKeys = at.refs.map((m) => `${verse}:${m}`)
      const allOpen =
        noteKeys.every((k) => expandedNotes.has(k)) && refKeys.every((k) => expandedRefs.has(k))
      if (allOpen) {
        forgetCites([...noteKeys.map((k) => `n${k}`), ...refKeys.map((k) => `r${k}`)])
      }
      setExpandedNotes((prev) => {
        const next = new Set(prev)
        for (const k of noteKeys) {
          if (allOpen) next.delete(k)
          else next.add(k)
        }
        persist({ notes: next })
        return next
      })
      setExpandedRefs((prev) => {
        const next = new Set(prev)
        for (const k of refKeys) {
          if (allOpen) next.delete(k)
          else next.add(k)
        }
        persist({ refs: next })
        return next
      })
    },
    [expandedNotes, expandedRefs, persist, forgetCites],
  )

  const toggleNote = useCallback(
    (verse: number, n: number) => {
      const key = `${verse}:${n}`
      setExpandedNotes((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
          forgetCites([`n${key}`])
        } else next.add(key)
        persist({ notes: next })
        return next
      })
    },
    [persist, forgetCites],
  )


  // --- 多選經節(手機)-------------------------------------------------------
  // Tap a verse to add/remove it from `selected`; the floating bar (non-modal,
  // so you can keep tapping) appears whenever ≥1 verse is chosen and copies /
  // shares them. Footnote sups still open notes (they stop propagation).
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const toggleSelect = useCallback((verse: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(verse)) next.delete(verse)
      else next.add(verse)
      return next
    })
  }, [])

  // Notes are selectable independently of their verse, keyed `${verse}:${n}`,
  // so 經文 and 註釋 can be picked / copied separately.
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(() => new Set())
  const toggleNoteSelect = useCallback((verse: number, n: number) => {
    const key = `${verse}:${n}`
    setSelectedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const hasSelection = selected.size > 0 || selectedNotes.size > 0
  const navigate = useNavigate()

  // True while the user has a live native text selection inside this panel — so
  // a partial-copy drag / long-press doesn't also toggle the whole verse, and
  // the pager pauses the swipe while they drag to select.
  const [textSelecting, setTextSelecting] = useState(false)

  // Clear selection whenever the chapter changes.
  useEffect(() => {
    setSelected(new Set())
    setSelectedNotes(new Set())
    // Not cleared but reloaded — the cross-refs and the citations inside every
    // card are saved per chapter. (The notes have their own sync effect above,
    // which also has the hl seeds to fold in.)
    const saved = readOpen(`rcv/open/${bookNo}/${chapterNo}`)
    setExpandedRefs(saved.refs)
    setCites(saved.cites)
  }, [bookNo, chapterNo, readOpen])

  // Bring a verse to the top of the panel, matching the gap the ?hl / ?oh jumps
  // land with. Instant, because the rail is dragged and has to track the finger.
  const scrubTo = useCallback((verse: number) => {
    const panel = panelRef.current
    const el = panel?.querySelector<HTMLElement>(`[data-verse="${verse}"]`)
    if (!panel || !el) return
    panel.scrollTop +=
      el.getBoundingClientRect().top - panel.getBoundingClientRect().top - 24
  }, [])

  useEffect(() => {
    if (!active) return
    onScrubApi?.(scrubTo)
    return () => onScrubApi?.(null)
  }, [active, onScrubApi, scrubTo])

  // Let the pager pause the swipe while a verse selection OR a text selection is
  // active.
  useEffect(() => {
    onSelectingChange?.(hasSelection || textSelecting)
  }, [hasSelection, textSelecting, onSelectingChange])

  // Every footnote in this chapter, keyed `verse:n`. Used by the「展開全部」
  // toggle below — empty when 顯示註釋 is off or the chapter has no notes.
  const allNoteKeys = useMemo(() => {
    const out = new Set<string>()
    for (const [verse, notes] of chapterNotes) {
      for (const n of notes) out.add(`${verse}:${n.n}`)
    }
    return out
  }, [chapterNotes])
  const allExpanded =
    allNoteKeys.size > 0 &&
    expandedNotes.size >= allNoteKeys.size &&
    Array.from(allNoteKeys).every((k) => expandedNotes.has(k))
  // Toggle every note in the chapter open or closed at once. The UI entry
  // point is currently hidden (we want to redesign it) but the behaviour is
  // wired up so a future control can drop it in. The `void` keeps tsc from
  // flagging the callback as unused while no caller references it.
  const toggleAll = useCallback(() => {
    const next = allExpanded ? new Set<string>() : new Set(allNoteKeys)
    setExpandedNotes(next)
    persist({ notes: next })
  }, [allExpanded, allNoteKeys, persist])
  void toggleAll
  const book = BOOK_BY_NO.get(bookNo)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // A card opens below its verse, so tapping a superscript near the fold leaves
  // it off the bottom of the screen — the reader taps and nothing appears to
  // happen. Both kinds behave alike, so both go through this.
  useRevealOnOpen(panelRef, expandedNotes, expandedRefs)

  // Track a live native text selection inside this panel (selectionchange is a
  // document-level event, so scope it to nodes within panelRef).
  useEffect(() => {
    if (!active) return
    const onSel = () => {
      const sel = document.getSelection()
      const el = panelRef.current
      const inside =
        !!sel &&
        !sel.isCollapsed &&
        sel.toString().trim().length > 0 &&
        !!el &&
        sel.anchorNode != null &&
        el.contains(sel.anchorNode)
      setTextSelecting(inside)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [active])

  const scrollRef = useRef<HTMLElement | null>(null)
  const assignScroll = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el
  }, [])
  const ohKey = ohIndex != null ? String(ohIndex) : ''
  // First verse touched by any hl item (verse range OR note ref) — used as
  // the scroll target so the landing position matches what the user clicked.
  const firstHlVerse =
    verseRanges[0]?.start ??
    (highlights.find((h) => h.kind === 'note' || h.kind === 'noteAll') as
      | { verse: number }
      | undefined)?.verse ??
    null

  const prevChapterKey = useRef('')
  useEffect(() => {
    if (!active || !data || (firstHlVerse == null && !ohKey)) return
    // Did we land on a different chapter, or just change the hl within the
    // same one? A chapter change reuses this component, so the scroll
    // container can still hold the previous chapter's (possibly much larger)
    // offset — smooth-scrolling from there shows a stretch of blank until the
    // animation catches up. So jump INSTANTLY for chapter changes, and keep
    // the smooth glide only for same-chapter hl moves (約1:14 → 約1:29).
    const chapterKey = `${bookNo}/${chapterNo}`
    const chapterChanged = prevChapterKey.current !== chapterKey
    prevChapterKey.current = chapterKey
    // Defer one frame so this runs AFTER the router's own scroll handling.
    const id = requestAnimationFrame(() => {
      // Belt-and-suspenders for chapter changes: clear any stale offset the
      // reused container kept from the (taller) previous chapter, so worst
      // case we land at the top — never in blank space past the content.
      if (chapterChanged) {
        const main = document.querySelector<HTMLElement>('[data-scroll-restoration-id="main"]')
        if (main) main.scrollTop = 0
      }
      // A link that named a note is asking for the note, not the verse it hangs
      // off — and the note can sit well below it. Land on the card, bringing the
      // verse along when there is room for both.
      const noteKey = [...noteHighlights][0]
      const noteEl = noteKey
        ? panelRef.current?.querySelector<HTMLElement>(`[data-note="${noteKey}"]`)
        : null
      if (noteEl) {
        const verseEl = scrollRef.current
        revealInScroll(verseEl ? [verseEl, noteEl] : noteEl, 'last')
        return
      }
      scrollRef.current?.scrollIntoView({
        block: 'start',
        // An outline-heading jump (?oh=) lands instantly — it's a deliberate
        // navigation, not a within-chapter verse glide. The smooth glide is kept
        // only for same-chapter hl moves (約1:14 → 約1:29).
        behavior: chapterChanged || ohKey ? 'auto' : 'smooth',
      })
    })
    return () => cancelAnimationFrame(id)
  }, [active, data, bookNo, chapterNo, firstHlVerse, ohKey, noteHighlights])

  // Per-panel scroll restoration. EVERY panel (including the off-screen prev/
  // next previews) is positioned to its saved offset up front, so a chapter is
  // already where it should be before you swipe to it — no jump after landing —
  // and it can't inherit a neighbour's scrollTop from a reused DOM node. Only
  // the active panel writes back. The active verse-jump view (?hl / ?oh) opts
  // out so the oh-scroll above can land on the verse instead.
  const isJumpView = ohIndex != null || firstHlVerse != null
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const key = `rcv/scroll/${bookNo}/${chapterNo}`
    const reapply: number[] = []
    if (!(active && isJumpView)) {
      const saved = sessionStorage.getItem(key)
      const target = saved !== null ? Number(saved) : 0
      const apply = () => {
        el.scrollTop = target
      }
      // Set before paint, then re-assert across the next couple of frames:
      // iOS WKWebView (standalone PWA) restores a freshly-mounted scroll
      // container to the old position AFTER our effect, so a one-shot set gets
      // clobbered — hence the inheritance only showing up in the installed app.
      apply()
      reapply.push(requestAnimationFrame(apply))
      reapply.push(requestAnimationFrame(() => reapply.push(requestAnimationFrame(apply))))
    }
    if (!active) return () => reapply.forEach(cancelAnimationFrame)
    // A verse/heading-focused view (?hl / ?oh) is transient: it skips restore
    // (above) and must also skip write-back. Otherwise scrolling to the target
    // verse would overwrite the plain reading position stored under the same
    // chapter key, so 返回 to /book/chapter would land on the verse instead of
    // where you were reading.
    if (isJumpView) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => sessionStorage.setItem(key, String(el.scrollTop)))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      reapply.forEach(cancelAnimationFrame)
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [active, bookNo, chapterNo, isJumpView])

  if (error) {
    return <p className="p-8 text-sm text-destructive">資料載入失敗：{error}</p>
  }
  if (!data) {
    return <p className="p-8 text-sm text-muted-foreground">載入中…</p>
  }
  if (!book) {
    return <p className="p-8 text-sm text-muted-foreground">找不到書卷</p>
  }

  const outlineMap = showOutline
    ? chapterOutlineByAnchor(outline, bookNo, chapterNo)
    : new Map<string, { entry: OutlineEntry; idx: number }[]>()

  // A tap just toggles the verse — the page stays put. The floating bar adds
  // bottom padding on the same render, so nothing it covers is unreachable;
  // scrolling the tapped verse to the middle moved the text out from under the
  // reader's finger, which is worse than the bar being close to it.
  const selectVerse = (verse: number) => {
    toggleSelect(verse)
  }

  // A quick tap selects the whole verse. A native text selection (drag on
  // desktop, long-press on mobile) is left to the browser so the user can copy
  // just the part they highlight — the text-selection guard keeps that gesture
  // from also toggling the verse. (No long-press verse-select: it would collide
  // with the OS long-press-to-select-text on mobile.)
  const versePress = (verse: number): React.ComponentProps<'div'> =>
    !active
      ? {}
      : {
          onClick: () => {
            const sel = document.getSelection()
            if (textSelecting || (sel != null && !sel.isCollapsed && sel.toString().trim().length > 0))
              return
            selectVerse(verse)
          },
        }

  // A native (Ctrl/⌘-C or long-press) copy of a text selection emits our own
  // citation format instead of the raw HTML: one line per verse or note, the
  // selected words quoted in 『』/"" with the reference. When only part of a verse
  // is taken the ref gains a 上/中/下 segment marker (prefix / middle / suffix);
  // notes carry no such marker, only 註N. A verse split by a mid-verse heading
  // spans several data-verse rows, so its portion is accumulated by verse number
  // and compared against the full verse.text. Verse numbers / footnote markers
  // are user-select:none, so they stay out, and a selection that touches neither
  // a verse nor a note (e.g. a cross-ref card) falls through to the browser's
  // plain copy. The action-bar copy uses clipboard.writeText and never fires this.
  const handleCopy = (e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    const panel = panelRef.current
    if (
      !sel ||
      sel.isCollapsed ||
      !panel ||
      sel.anchorNode == null ||
      !panel.contains(sel.anchorNode)
    ) {
      return
    }
    const whole = sel.toString().trim()
    if (!whole) return
    const range = sel.getRangeAt(0)
    const isEn = /[A-Za-z]/.test(whole) && !/[\u4e00-\u9fff]/.test(whole)

    const cleanText = (frag: DocumentFragment): string => {
      const div = document.createElement('div')
      div.appendChild(frag)
      div.querySelectorAll('.select-none').forEach((n) => n.remove())
      return (div.textContent ?? '').replace(/\s+/g, ' ').trim()
    }

    // Walk the marked elements in document order so the emitted lines read in
    // the same order as the page: verse, then whatever notes were opened under it.
    const byVerse = new Map<number, string>()
    const byNote = new Map<string, string>()
    const order: string[] = []
    panel.querySelectorAll<HTMLElement>('[data-verse],[data-note]').forEach((el) => {
      if (!range.intersectsNode(el)) return
      const nr = document.createRange()
      nr.selectNodeContents(el)
      const inter = range.cloneRange()
      if (inter.compareBoundaryPoints(Range.START_TO_START, nr) < 0) {
        inter.setStart(nr.startContainer, nr.startOffset)
      }
      if (inter.compareBoundaryPoints(Range.END_TO_END, nr) > 0) {
        inter.setEnd(nr.endContainer, nr.endOffset)
      }
      const portion = cleanText(inter.cloneContents())
      if (!portion) return
      const noteAttr = el.getAttribute('data-note')
      if (noteAttr) {
        const key = `n${noteAttr}`
        if (!byNote.has(key)) order.push(key)
        byNote.set(key, (byNote.get(key) ?? '') + portion)
      } else {
        const verse = Number(el.getAttribute('data-verse'))
        const key = `v${verse}`
        if (!byVerse.has(verse)) order.push(key)
        byVerse.set(verse, (byVerse.get(verse) ?? '') + portion)
      }
    })
    if (order.length === 0) return

    const norm = (s: string) => s.replace(/\s+/g, '')
    const lines = order.map((key) => {
      if (key.startsWith('n')) {
        const [verseStr, nStr] = key.slice(1).split(':')
        const label = `${formatVerseRef(bookNo, chapterNo, Number(verseStr), citeFormat)}註${nStr}`
        return formatCitation(label, `『${byNote.get(key) ?? ''}』`, citePosition)
      }
      const verse = Number(key.slice(1))
      const portion = byVerse.get(verse) ?? ''
      if (isEn) {
        const abbr = BOOK_ABBREV_EN[bookNo] ?? ''
        return formatCitation(`${abbr} ${chapterNo}:${verse}`, `"${portion}"`, citePosition, ' ')
      }
      const full = norm(chapter?.verses.find((x) => x.verse === verse)?.text ?? '')
      const p = norm(portion)
      // Which slice of the verse was taken → 上 (prefix) / 下 (suffix) / 中 (middle);
      // no marker when the whole verse (or an unmatched fragment) is selected.
      let segMark = ''
      if (p && full && p !== full) {
        if (full.startsWith(p)) segMark = '上'
        else if (full.endsWith(p)) segMark = '下'
        else if (full.includes(p)) segMark = '中'
      }
      const label = formatVerseRef(bookNo, chapterNo, verse, citeFormat) + segMark
      return formatCitation(label, `『${portion}』`, citePosition)
    })

    e.clipboardData.setData('text/plain', lines.join('\n'))
    e.preventDefault()
  }

  // en / both only apply with English loaded; otherwise force 中文.
  const copyLangEff: CopyLang = showEnglish ? copyLang : 'zh'
  // Shared by the blue selection bar (verseSet=selected) and the yellow hl bar
  // (verseSet=highlighted verses) — same citation format either way.
  const buildCopyText = (verseSet: Set<number>, noteSet: Set<string>) => {
    const sep = copyLangEff === 'both' ? '\n\n' : '\n'
    const parts: string[] = []
    for (const v of chapter?.verses ?? []) {
      if (verseSet.has(v.verse)) {
        const zh = formatCitation(
          formatVerseRef(bookNo, chapterNo, v.verse, citeFormat),
          `『${v.text}』`,
          citePosition,
        )
        if (copyLangEff === 'zh') {
          parts.push(zh)
        } else {
          const enText = enChapter?.verses.find((x) => x.verse === v.verse)?.text
          const en = enText
            ? formatCitation(
                `${BOOK_ABBREV_EN[bookNo] ?? ''} ${chapterNo}:${v.verse}`,
                `"${enText}"`,
                citePosition,
                ' ',
              )
            : ''
          if (copyLangEff === 'en') {
            if (en) parts.push(en)
          } else {
            parts.push(enText ? `${zh}\n${en}` : zh)
          }
        }
      }
      // Notes on this verse (Chinese only), kept in note order.
      if (noteSet.size > 0) {
        const vNotes = chapterNotes.get(v.verse) ?? []
        for (const n of vNotes) {
          if (noteSet.has(`${v.verse}:${n.n}`)) {
            const label = `${formatVerseRef(bookNo, chapterNo, v.verse, citeFormat)}註${n.n}`
            parts.push(formatCitation(label, `『${n.text}』`, citePosition))
          }
        }
      }
    }
    return parts.filter(Boolean).join(sep)
  }
  const selectedText = () => buildCopyText(selected, selectedNotes)

  const exitSelection = () => {
    setSelected(new Set())
    setSelectedNotes(new Set())
  }

  const copySelected = async () => {
    const text = selectedText()
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        /* clipboard denied */
      }
    }
    exitSelection()
  }

  const shareSelected = async () => {
    const text = selectedText()
    if (!text) return
    try {
      if (navigator.share) await navigator.share({ text })
      else await navigator.clipboard.writeText(text)
      exitSelection() // only dismiss after a completed share — keep the
      // selection if the user backs out of the share sheet.
    } catch {
      /* cancelled / denied — leave the selection so they can retry */
    }
  }

  // Yellow (?hl=) action bar: the verses / notes the URL is tinting. Only shown
  // when there's no manual (blue) selection.
  const hlVerseSet = new Set<number>()
  for (const v of chapter?.verses ?? []) {
    if (v.verse !== 0 && verseRanges.some((r) => v.verse >= r.start && v.verse <= r.end)) {
      hlVerseSet.add(v.verse)
    }
  }
  const hlNoteSet = noteHighlights
  const hlActive = active && !hasSelection && (hlVerseSet.size > 0 || hlNoteSet.size > 0)
  const hlText = () => buildCopyText(hlVerseSet, hlNoteSet)
  // ✕ removes the highlight by stripping ?hl= from the URL — so re-clicking the
  // same search result re-adds it and re-lights the verse (a local dismiss
  // wouldn't, since the URL never changed). Persist the current scroll first so
  // the restore that fires when hl clears keeps us on the verse instead of
  // jumping back to the old reading position.
  const clearHl = () => {
    const el = panelRef.current
    if (el) sessionStorage.setItem(`rcv/scroll/${bookNo}/${chapterNo}`, String(el.scrollTop))
    navigate({
      to: '/$bookNo/$chapterNo',
      params: { bookNo, chapterNo },
      search: {},
      replace: true,
      resetScroll: false,
    })
  }
  const copyHl = async () => {
    const text = hlText()
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        /* clipboard denied */
      }
    }
  }
  const shareHl = async () => {
    const text = hlText()
    if (!text) return
    try {
      if (navigator.share) await navigator.share({ text })
      else await navigator.clipboard.writeText(text)
    } catch {
      /* cancelled / denied */
    }
  }

  const rows: Row[] = []
  let headingRefDone = false
  if (chapter) {
    for (const v of chapter.verses) {
      const hl = verseRanges.some((r) => v.verse >= r.start && v.verse <= r.end)
      const isFirst = v.verse === firstHlVerse
      const headingsAt = (seg: number) => outlineMap.get(`${v.verse}:${seg}`) ?? []
      const segCount = v.segments?.length ?? 1
      const anyMid =
        segCount > 1 &&
        Array.from({ length: segCount }, (_, s) => s).some((s) => s > 0 && headingsAt(s).length > 0)

      const pushHeading = (e: OutlineEntry, idx: number, key: string) => {
        const isTarget = idx === ohIndex
        const takeRef = isTarget && !headingRefDone
        if (takeRef) headingRefDone = true
        rows.push({
          kind: 'heading',
          entry: e,
          idx,
          tight: rows[rows.length - 1]?.kind === 'heading',
          hl: isTarget,
          ref: takeRef,
          key,
        })
      }

      // English text for this verse (under the LAST segment if split, else the
      // single row). 詩篇 v0 superscriptions don't have an English equivalent
      // in this DB, so the lookup naturally returns undefined and we skip.
      const enText = enChapter?.verses.find((x) => x.verse === v.verse)?.text
      const verseNotes = chapterNotes.get(v.verse)

      if (anyMid && v.segments) {
        let off = 0
        const lastSeg = v.segments.length - 1
        v.segments.forEach((segText, s) => {
          headingsAt(s).forEach(({ entry, idx }, i) => pushHeading(entry, idx, `h${v.verse}-${s}-${i}`))
          rows.push({
            kind: 'verse',
            verse: v.verse,
            num: s === 0 && v.verse !== 0 ? v.verse : '',
            text: segText,
            en: s === lastSeg ? enText : undefined,
            marks: sliceMarks(v.marks, off, off + segText.length),
            // A split verse's notes / cross-refs are anchored against the whole
            // verse, so each fragment takes the ones that land inside it.
            notes: sliceNotes(verseNotes, off, off + segText.length),
            refs: sliceCrossRefs(chapterRefs.get(v.verse), off, off + segText.length),
            hl,
            ref: isFirst && s === 0,
            key: `v${v.verse}-${s}`,
          })
          off += segText.length
        })
      } else {
        headingsAt(0).forEach(({ entry, idx }, i) => pushHeading(entry, idx, `h${v.verse}-${i}`))
        rows.push({
          kind: 'verse',
          verse: v.verse,
          num: v.verse === 0 ? '' : v.verse,
          text: v.text,
          en: enText,
          marks: v.marks,
          notes: verseNotes,
          refs: chapterRefs.get(v.verse),
          hl,
          ref: isFirst,
          key: `v${v.verse}`,
        })
      }
    }
  }

  return (
    <>
      {/* One carousel panel: its own vertical scroll. The header / paging /
       * swipe live in the pager above; this is just the chapter body. */}
      <div
        ref={panelRef}
        onCopy={handleCopy}
        className="h-full overflow-y-auto overscroll-y-contain scroll-pt-6 pb-[var(--nav-h)] [overflow-anchor:none] md:pb-0"
      >
      <article
        className={cn(
          // Extra bottom room while selecting so the last verses can scroll
          // above the floating selection card, keeping the same breathing room
          // they normally have: original py (1.5rem) + card height (h-14 =
          // 3.5rem) + the card's 0.75rem inset above the nav = 92px. The
          // transition stays defined and only the duration toggles: instant
          // (duration-0) when it appears so the scroll-to-centre has room right
          // away, but eased (duration-300) when it collapses so the margin
          // shrinks smoothly on exit.
          'mx-auto max-w-3xl px-4 py-6 transition-[padding-bottom] md:px-8 md:py-10',
          // Clear of the verse rail, which floats over this edge on touch.
          isTouch && 'pr-6',
          hasSelection || hlActive
            ? 'pb-[calc(1.5rem+3.5rem+0.75rem)] duration-0'
            : 'duration-300',
        )}
      >
        {/* TODO: 展開/收起所有註釋 — toggleAll + allExpanded are wired up
         * and ready (see useMemo above); UI is hidden until we decide on a
         * better entry point than a top-right text button. */}
        {chapter ? (
        <div className="grid grid-cols-[minmax(1.3125em,auto)_1fr] gap-x-2 gap-y-2.5 font-serif text-[length:var(--reading-fs,1rem)]">
          {rows.map((r) =>
            r.kind === 'heading' ? (
              <OutlineHeading
                key={r.key}
                entry={r.entry}
                entryIdx={r.idx}
                tight={r.tight}
                highlight={r.hl}
                innerRef={r.ref ? assignScroll : undefined}
                bookNo={bookNo}
              />
            ) : (
              <Fragment key={r.key}>
                <span
                  ref={r.ref ? assignScroll : undefined}
                  {...versePress(r.verse)}
                  className="pt-[0.25em] text-right text-[0.75em] font-sans tabular-nums text-muted-foreground select-none"
                >
                  {/* The tint goes on the digits, not on this cell: the cell is
                    * a grid item whose area is the whole row, and a row holding
                    * open cards is tall — painting it drew a band the height of
                    * everything below.
                    *
                    * px-1/-mx-1 gives the tint room without moving the digits
                    * out of their column. py-1 needs no such pairing: vertical
                    * padding on an inline box paints without taking space, so
                    * the chip grows and the line doesn't. */}
                  <span
                    className={cn(
                      r.hl &&
                        !selected.has(r.verse) &&
                        'rounded-sm bg-highlight/25 px-1 py-1 -mx-1 font-semibold text-foreground',
                    )}
                  >
                    {r.num}
                  </span>
                </span>
                {/* No select-none here: the verse text is natively selectable so
                 * the user can drag / long-press to copy just part of it. */}
                <div {...versePress(r.verse)}>
                  {/* One continuous selection tint over the verse + its English,
                   * like the search results. The navigate (r.hl) tint stays on
                   * the Chinese line, and yields to the selection tint.
                   * data-verse sits here, not on the row: it marks what counts
                   * as verse text for handleCopy, so selecting inside the note /
                   * cross-ref cards below copies plainly instead of coming out
                   * dressed as a verse citation. */}
                  <div
                    data-verse={r.verse}
                    className={cn(
                      'rounded px-1 -mx-1',
                      selected.has(r.verse) && 'bg-blue-500/20 dark:bg-blue-400/25',
                    )}
                  >
                    <p className="px-1 -mx-1 font-medium leading-relaxed">
                      {renderMarkedText(r.text, r.marks, r.notes, r.refs, (at) =>
                        toggleMarkers(r.verse, at),
                      )}
                    </p>
                    {r.en && (
                      <p className="mt-0.5 font-sans text-[0.9em] text-muted-foreground">{r.en}</p>
                    )}
                  </div>
                  {/* Notes and cross-references share one list, ordered by
                    * where their markers sit in the verse rather than kind
                    * before kind: the cards then read in the order the eye met
                    * the markers. A marker anchored in several places is placed
                    * by its first. */}
                  {(() => {
                    const cards = [
                      ...(r.refs ?? [])
                        .filter((x) => expandedRefs.has(`${r.verse}:${x.m}`))
                        .map((x) => ({ at: Math.min(...x.offsets), note: null, ref: x })),
                      ...(r.notes ?? [])
                        .filter((n) => expandedNotes.has(`${r.verse}:${n.n}`))
                        .map((n) => ({ at: Math.min(...n.offsets), note: n, ref: null })),
                    ]
                      // Same position → in the order the marker spells them:
                      // footnotes before cross-references, each in its own
                      // sequence. Comparing only the kind was not a comparator
                      // at all — two footnotes each claimed to come first, and
                      // the sort read that as "move it further" and reversed
                      // them, so 「12a」 opened as 2, 1, a.
                      .sort(
                        (a, b) =>
                          a.at - b.at ||
                          Number(!a.note) - Number(!b.note) ||
                          (a.note && b.note
                            ? a.note.n - b.note.n
                            : a.ref!.m.localeCompare(b.ref!.m)),
                      )
                    if (cards.length === 0) return null
                    return (
                      <CardList>
                        {cards.map((card) =>
                        card.note ? (
                          <NoteCard
                            key={`n${card.note.n}`}
                            note={card.note}
                            verse={r.verse}
                            bookNo={bookNo}
                            chapterNo={chapterNo}
                            onClose={(n) => toggleNote(r.verse, n)}
                            open={cites[`n${r.verse}:${card.note.n}`] ?? null}
                            onOpen={(at) => setCite(`n${r.verse}:${card.note!.n}`, at)}
                            highlighted={noteHighlights.has(`${r.verse}:${card.note.n}`)}
                            selected={selectedNotes.has(`${r.verse}:${card.note.n}`)}
                            onSelect={
                              active
                                ? (n) => {
                                    // A drag that ends on the card is the reader
                                    // selecting text, not asking to select the note.
                                    if (textSelecting) return
                                    toggleNoteSelect(r.verse, n)
                                  }
                                : undefined
                            }
                          />
                        ) : (
                          <CrossRefCard
                            key={`r${card.ref!.m}`}
                            crossRef={card.ref!}
                            verse={r.verse}
                            bookNo={bookNo}
                            chapterNo={chapterNo}
                            onClose={(m) => toggleRef(r.verse, m)}
                            open={cites[`r${r.verse}:${card.ref!.m}`] ?? null}
                            onOpen={(at) => setCite(`r${r.verse}:${card.ref!.m}`, at)}
                          />
                          ),
                        )}
                      </CardList>
                    )
                  })()}
                </div>
              </Fragment>
            ),
          )}
        </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            {book.name} 第 {chapterNo} 章 — 資料尚未爬取
          </div>
        )}
      </article>
      </div>

      {/* Non-modal selection card (no overlay) so the verses behind it stay
       * tappable and you can keep adding to the selection. Portalled to <body>
       * so it escapes the carousel track's transform / overflow-clip — a fixed
       * child of a transformed element is positioned (and clipped) by it, not
       * the viewport. Only the active panel owns it. */}
      {active &&
        hasSelection &&
        createPortal(
          <div className="fixed inset-x-3 bottom-[calc(var(--nav-h)+0.75rem)] z-40 flex h-14 items-center gap-3 rounded-xl border border-border bg-popover/95 px-4 pr-2.5 text-sm shadow-lg backdrop-blur md:inset-x-auto md:right-3 md:bottom-3 md:min-w-[384px]">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm bg-blue-500/20 dark:bg-blue-400/25"
            />
            <span className="truncate">
              已選 {selected.size > 0 ? `${selected.size} 節` : `${selectedNotes.size} 註`}：
              {summarizeSelection(selected, selectedNotes)}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={shareSelected}
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95"
            >
              分享
            </button>
            <button
              type="button"
              onClick={copySelected}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95"
            >
              複製
            </button>
            <button
              type="button"
              onClick={exitSelection}
              aria-label="取消"
              className="rounded-lg px-2 py-2 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95"
            >
              <X className="size-4.5" />
            </button>
          </div>
        </div>,
          document.body,
        )}

      {/* Yellow (?hl=) action bar — copy/share what you jumped to; X removes the
       * tint (locally, without touching the URL). Hidden once a manual (blue)
       * selection begins. The gold swatch signals it's the highlight, not a
       * selection. */}
      {hlActive &&
        createPortal(
          <div className="fixed inset-x-3 bottom-[calc(var(--nav-h)+0.75rem)] z-40 flex h-14 items-center gap-3 rounded-xl border border-border bg-popover/95 px-4 pr-2.5 text-sm shadow-lg backdrop-blur md:inset-x-auto md:right-3 md:bottom-3 md:min-w-[384px]">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
            {/* The gold swatch signals it's the highlight, not a selection —
              * the same shape the selection bar uses, in its own colour. */}
            <span aria-hidden className="size-3 shrink-0 rounded-sm bg-highlight/25" />
            <span className="truncate">
              已標示 {hlVerseSet.size > 0 ? `${hlVerseSet.size} 節` : `${hlNoteSet.size} 註`}：
              {summarizeSelection(hlVerseSet, hlNoteSet)}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={shareHl}
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95"
            >
              分享
            </button>
            <button
              type="button"
              onClick={copyHl}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95"
            >
              複製
            </button>
            <button
              type="button"
              onClick={clearHl}
              aria-label="移除標示"
              className="rounded-lg px-2 py-2 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95"
            >
              <X className="size-4.5" />
            </button>
          </div>
        </div>,
          document.body,
        )}
    </>
  )
}
