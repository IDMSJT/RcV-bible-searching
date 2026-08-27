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
import { createPortal, flushSync } from 'react-dom'
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
import { ScrollBody } from '@/components/ScrollBody'
import { rememberScroll } from '@/lib/scrollMemory'
import {
  FLOATING_ACTION_BAR_CLS,
  ACTION_BAR_BTN,
  ACTION_BAR_BTN_PRIMARY,
  ACTION_BAR_BTN_GHOST,
} from '@/lib/chrome'
import type { HlItem } from '@/lib/highlight'
import { REVEAL_GAP, revealInScroll } from '@/lib/revealInScroll'
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
  onScrubApi?: (scrub: ((verse: number | null) => void) | null) => void
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

  /** Which verse the 經節軌 is being held over, or null when it isn't. */
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  // Bring a verse to the top of the panel, matching the gap the ?hl / ?oh jumps
  // land with. Instant, because the rail is dragged and has to track the finger.
  //
  // Also tints the verse the 數字泡泡 is naming, so the bubble and the text agree
  // about where the finger is: the top of the panel is a coarse answer on a
  // chapter whose verses run long, and on the last screenful the scroll stops
  // moving altogether while the bubble keeps counting. null is the lift.
  const scrubTo = useCallback((verse: number | null) => {
    // flushSync so the grey tint is committed to the DOM before we scroll:
    // otherwise the scroll (synchronous) lands this frame and the tint (a React
    // re-render) only the next, so the verse arrives a frame before its colour
    // — a visible flash as you drag. Committing both before the browser paints
    // shows them together.
    flushSync(() => setScrubbing(verse))
    if (verse == null) return
    const panel = panelRef.current
    const el = panel?.querySelector<HTMLElement>(`[data-verse="${verse}"]`)
    if (!panel || !el) return
    panel.scrollTop +=
      el.getBoundingClientRect().top - panel.getBoundingClientRect().top - REVEAL_GAP
  }, [])

  useEffect(() => {
    if (!active) return
    onScrubApi?.(scrubTo)
    // A panel that stops being the active one can't be told the finger lifted,
    // so it clears its own tint on the way out.
    return () => {
      onScrubApi?.(null)
      setScrubbing(null)
    }
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

  /** Where the last jump was aimed, so a re-run can tell a reader's move from
   * the page catching up with itself. */
  const lastJump = useRef('')
  useEffect(() => {
    if (!active || !data || (firstHlVerse == null && !ohKey)) return
    // Arriving at a chapter, the panel opens at the top, and gliding from there
    // shows a stretch of blank until the animation catches up. So an arrival
    // lands INSTANTLY, and the smooth glide is kept for the one case that earns
    // it: the reader moving the hl inside the chapter they are already reading
    // (約1:14 → 約1:29), watching the page travel between two verses they can
    // both see. An outline jump (?oh=) is a navigation, never a glide.
    //
    // Keyed on the target and not on the chapter, because this effect runs
    // again when the annotations land — same destination, second pass, since
    // they arrive on their own clock after the chapter's own data. That pass is
    // the page correcting itself now the note cards have taken their room, and
    // it has to be instant too: keyed on the chapter, the first pass spent the
    // signal and the correction inherited the glide, so arriving cross-chapter
    // looked like a jump to the top followed by a long slide down.
    const target = `${bookNo}/${chapterNo}/${firstHlVerse ?? ''}/${ohKey}`
    const readerMoved =
      lastJump.current !== '' &&
      lastJump.current !== target &&
      lastJump.current.startsWith(`${bookNo}/${chapterNo}/`)
    lastJump.current = target
    const behavior: ScrollBehavior = readerMoved && !ohKey ? 'smooth' : 'instant'
    // Defer one frame so this runs after the layout has settled.
    const id = requestAnimationFrame(() => {
      // A link that named a note is asking for the note, not the verse it hangs
      // off — and the note can sit well below it. Land on the card, bringing the
      // verse along when there is room for both.
      const noteKey = [...noteHighlights][0]
      const noteEl = noteKey
        ? panelRef.current?.querySelector<HTMLElement>(`[data-note="${noteKey}"]`)
        : null
      if (noteEl) {
        const verseEl = scrollRef.current
        revealInScroll(verseEl ? [verseEl, noteEl] : noteEl, { keep: 'last', behavior })
        return
      }
      if (!scrollRef.current) return
      // Named, so it goes to the top even if it was already on screen.
      revealInScroll(scrollRef.current, { align: 'top', behavior })
    })
    return () => cancelAnimationFrame(id)
  }, [active, data, bookNo, chapterNo, firstHlVerse, ohKey, noteHighlights])

  // A verse/heading-focused view (?hl / ?oh) is transient: ScrollBody neither
  // restores into it nor records it, so the jump lands on the verse and the
  // plain reading position underneath is left alone. (Only ever true for the
  // active panel — the neighbours get no hl/oh; they restore-only instead, so a
  // swipe back reveals them already at the reader's last position.)
  const isJumpView = ohIndex != null || firstHlVerse != null


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

  // A tap toggles the verse. The page normally stays put — moving the tapped
  // verse out from under the finger is worse than the bar sitting near it — but
  // a verse clipped by the top edge, or hidden under the selection bar that
  // appears at the bottom, is the very thing you just selected. So, once the bar
  // has rendered, bring the added verse fully between the top edge and the bar
  // if it isn't; a verse already in view doesn't move. A verse taller than that
  // gap shows its start.
  const selectVerse = (verse: number) => {
    const adding = !selected.has(verse)
    toggleSelect(verse)
    if (!adding) return
    requestAnimationFrame(() => {
      const panel = panelRef.current
      const el = panel?.querySelector<HTMLElement>(`[data-verse="${verse}"]`)
      if (!panel || !el) return
      const bar = document.querySelector<HTMLElement>('[data-action-bar]')
      const r = el.getBoundingClientRect()
      const top = panel.getBoundingClientRect().top + REVEAL_GAP
      const bottom = (bar?.getBoundingClientRect().top ?? panel.getBoundingClientRect().bottom) - REVEAL_GAP
      const delta = r.top < top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : 0
      if (delta !== 0) panel.scrollTo({ top: panel.scrollTop + delta, behavior: 'smooth' })
    })
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
    rememberScroll(panelRef.current, `/${bookNo}/${chapterNo}`)
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
      <ScrollBody
        ref={panelRef}
        // Its own chapter, not the URL's — the two carousel neighbours are
        // mounted under the middle panel's pathname, so each must name its own
        // key or they'd all read/write the same slot.
        restoreKey={`/${bookNo}/${chapterNo}`}
        paused={isJumpView}
        restoreOnly={!active}
        onCopy={handleCopy}
        className="h-full overscroll-y-contain [overflow-anchor:none]"
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
                  // At 0.75em the number needs a line-height of 1.625 / 0.75 ≈
                  // 2.167 to make a line box the same height as the verse text's
                  // first line (1em × leading-relaxed = 1.625em), so the digit
                  // sits centred against it — no manual top nudge. Update both if
                  // the body line-height changes.
                  className="text-right text-[0.75em] leading-[2.167] font-sans tabular-nums text-muted-foreground select-none"
                >
                  {/* The tint goes on the digits, not on this cell: the cell is
                    * a grid item whose area is the whole row, and a row holding
                    * open cards is tall — painting it drew a band the height of
                    * everything below.
                    *
                    * The chip is drawn as a ring, not as padding. Padding needed
                    * a matching -mx-1 to keep the digits from moving when the
                    * tint appeared, and that pair — padding plus a negative
                    * margin, on an inline box inside a right-aligned track — is
                    * where the phone and the desktop stopped agreeing: measured
                    * off a screenshot, the left 4px simply wasn't drawn, so the
                    * digits sat off-centre in their own chip. A ring is painted
                    * outward from the border box and joins no layout at all, so
                    * there is nothing left to disagree about — and in Chrome it
                    * covers the same pixels the padded one did. The ring's width
                    * is added to the corner radius, hence the smaller one. */}
                  <span
                    className={cn(
                      'rounded-xs',
                      r.hl &&
                        !selected.has(r.verse) &&
                        'bg-highlight/25 font-semibold text-foreground ring-4 ring-highlight/25',
                      // The rail's tint yields to both of the others: gold and
                      // the selection each say something that outlasts the drag,
                      // and this only says where the finger is.
                      scrubbing === r.verse &&
                        !r.hl &&
                        !selected.has(r.verse) &&
                        'bg-muted text-foreground ring-4 ring-muted',
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
                    <p className="px-1 -mx-1 font-normal leading-relaxed">
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
      </ScrollBody>

      {/* Non-modal selection card (no overlay) so the verses behind it stay
       * tappable and you can keep adding to the selection. Portalled to <body>
       * so it escapes the carousel track's transform / overflow-clip — a fixed
       * child of a transformed element is positioned (and clipped) by it, not
       * the viewport. Only the active panel owns it. */}
      {active &&
        hasSelection &&
        createPortal(
          <div
            data-action-bar
            className={FLOATING_ACTION_BAR_CLS}
          >
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
              className={ACTION_BAR_BTN}
            >
              分享
            </button>
            <button
              type="button"
              onClick={copySelected}
              className={ACTION_BAR_BTN_PRIMARY}
            >
              複製
            </button>
            <button
              type="button"
              onClick={exitSelection}
              aria-label="取消"
              className={ACTION_BAR_BTN_GHOST}
            >
              <X className="size-4" />
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
          <div
            data-action-bar
            className={FLOATING_ACTION_BAR_CLS}
          >
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
              className={ACTION_BAR_BTN}
            >
              分享
            </button>
            <button
              type="button"
              onClick={copyHl}
              className={ACTION_BAR_BTN_PRIMARY}
            >
              複製
            </button>
            <button
              type="button"
              onClick={clearHl}
              aria-label="移除標示"
              className={ACTION_BAR_BTN_GHOST}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>,
          document.body,
        )}
    </>
  )
}
