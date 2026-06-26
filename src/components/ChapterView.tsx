import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import {
  useBible,
  useBibleEn,
  useOutline,
  useAnnotations,
  findChapter,
  findAnnotationChapter,
  chapterOutlineByAnchor,
} from '@/data/loadBible'
import { BOOK_BY_NO } from '@/data/canon'
import { formatVerseRef, DEFAULT_CITE_FORMAT, type CiteFormat } from '@/lib/cite'
import { chapterUnit, formatOutlineRange, displayMarker } from '@/lib/chinese'
import { renderMarkedText, sliceMarks, NoteList } from '@/lib/renderVerse'
import type { HlItem } from '@/lib/highlight'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import { ReaderFrame } from '@/components/ReaderFrame'
import type { Annotation, Mark, OutlineEntry } from '@/types/bible'

function OutlineHeading({
  entry,
  tight,
  highlight,
  innerRef,
}: {
  entry: OutlineEntry
  tight: boolean
  highlight?: boolean
  innerRef?: (el: HTMLDivElement | null) => void
}) {
  // Indent is a left margin (not padding) so the highlight bg starts at the
  // text, not at the column edge. When highlighted, px-1 adds a little breathing
  // room and the margins are pulled in by 0.25rem to compensate (no layout shift).
  const indent = (entry.level - 1) * 0.5
  const cls =
    'col-start-2 justify-self-start flex gap-1.5 font-sans text-[0.875em] text-muted-foreground ' +
    (tight ? '' : 'mt-2 first:mt-0 ') +
    (highlight ? 'rounded bg-highlight px-1' : '')
  const style = highlight
    ? { marginLeft: `calc(${indent}rem - 0.25rem)`, marginRight: '-0.25rem' }
    : { marginLeft: `${indent}rem` }

  return (
    <div ref={innerRef} className={cls} style={style}>
      {entry.marker && <span className="shrink-0">{displayMarker(entry.marker)}</span>}
      <span>
        {entry.title}
        {entry.continued && ' (續)'}
        {entry.range && (
          <span className="ml-1.5 text-muted-foreground/60">{formatOutlineRange(entry.range)}</span>
        )}
      </span>
    </div>
  )
}

type Row =
  | { kind: 'heading'; entry: OutlineEntry; tight: boolean; hl: boolean; ref: boolean; key: string }
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
      hl: boolean
      ref: boolean
      key: string
    }

export function ChapterView({
  bookNo,
  chapterNo,
  highlights = [],
  headingAnchor,
  leftAction,
  rightAction,
  onSwipePrev,
  onSwipeNext,
  prevLabel,
  nextLabel,
}: {
  bookNo: number
  chapterNo: number
  /** Combined highlight list — verses to tint and / or notes to expand+tint. */
  highlights?: HlItem[]
  headingAnchor?: { verse: number; segment: number }
  leftAction?: ReactNode
  rightAction?: ReactNode
  /** Mobile swipe-right / swipe-left chapter navigation (undefined = disabled
   * for that direction, e.g. at the canon's edges). */
  onSwipePrev?: () => void
  onSwipeNext?: () => void
  /** Labels of the swipe targets, peeked in from the edge while dragging. */
  prevLabel?: string
  nextLabel?: string
}) {
  const { data, error } = useBible()
  const { data: outline } = useOutline()
  const [showOutline] = useLocalStorage('rcv/show-outline', true)
  const [showEnglish] = useLocalStorage('rcv/show-english', false)
  const [showNotes] = useLocalStorage('rcv/show-notes', true)
  const [citeFormat] = useLocalStorage<CiteFormat>('rcv/cite-format', DEFAULT_CITE_FORMAT)
  const { data: bibleEn } = useBibleEn(showEnglish)
  const { data: annotations } = useAnnotations(showNotes)
  const enChapter = showEnglish ? findChapter(bibleEn, bookNo, chapterNo) : null
  const annChapter = showNotes ? findAnnotationChapter(annotations, bookNo, chapterNo) : null
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
        const vNotes = annChapter?.verses.find((x) => x.verse === h.verse)?.notes ?? []
        for (const n of vNotes) s.add(`${h.verse}:${n.n}`)
      }
    }
    return s
  }, [highlights, annChapter])

  // Persist the open-footnote set per chapter in sessionStorage so navigating
  // to a referenced verse and pressing 「back」 (or hitting refresh) returns
  // you to the same expanded state. Initial state is read synchronously from
  // storage to avoid the first-render race where a write-on-change effect
  // would clobber the saved set with the empty initial state. Highlighted
  // notes from hl are unioned in so an inbound 「?hl=…:N」 link auto-expands
  // that body.
  const notesKey = `rcv/notes-open/${bookNo}/${chapterNo}`
  const readStorage = useCallback((key: string): Set<string> => {
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch {
      /* malformed JSON — start fresh */
    }
    return new Set<string>()
  }, [])
  const writeStorage = useCallback((key: string, set: Set<string>) => {
    if (set.size > 0) {
      sessionStorage.setItem(key, JSON.stringify(Array.from(set)))
    } else {
      sessionStorage.removeItem(key)
    }
  }, [])
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => {
    const initial = readStorage(`rcv/notes-open/${bookNo}/${chapterNo}`)
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
  const prevNotesKeyRef = useRef(notesKey)
  // useLayoutEffect (not useEffect) so the hl note expands BEFORE the browser
  // paints — otherwise the user sees one frame without it, then it pops in.
  useLayoutEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      prevNotesKeyRef.current = notesKey
      // Persist the mount-time hl seeds so a later return restores them.
      if (noteHighlights.size > 0) writeStorage(notesKey, expandedNotesRef.current)
      return
    }
    const chapterChanged = prevNotesKeyRef.current !== notesKey
    prevNotesKeyRef.current = notesKey
    const base = chapterChanged ? readStorage(notesKey) : new Set(expandedNotesRef.current)
    let added = false
    for (const k of noteHighlights) {
      if (!base.has(k)) {
        base.add(k)
        added = true
      }
    }
    if (chapterChanged || added) {
      setExpandedNotes(base)
      writeStorage(notesKey, base)
    }
  }, [notesKey, noteHighlights, readStorage, writeStorage])

  const toggleNote = useCallback(
    (verse: number, n: number) => {
      setExpandedNotes((prev) => {
        const key = `${verse}:${n}`
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        writeStorage(notesKey, next)
        return next
      })
    },
    [notesKey, writeStorage],
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

  // In-flight press: the long-press timer, the start point (to cancel on
  // scroll), and whether the long-press already fired (so the trailing click
  // doesn't toggle the verse back off).
  const pressRef = useRef<{ x: number; y: number; long: boolean; timer: number } | null>(null)

  // Clear selection whenever the chapter changes.
  useEffect(() => {
    setSelected(new Set())
  }, [bookNo, chapterNo])

  // Every footnote in this chapter, keyed `verse:n`. Used by the「展開全部」
  // toggle below — empty when 顯示註釋 is off or the chapter has no notes.
  const allNoteKeys = useMemo(() => {
    const out = new Set<string>()
    if (!annChapter) return out
    for (const v of annChapter.verses) {
      for (const n of v.notes) out.add(`${v.verse}:${n.n}`)
    }
    return out
  }, [annChapter])
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
    writeStorage(notesKey, next)
  }, [allExpanded, allNoteKeys, notesKey, writeStorage])
  void toggleAll
  const book = BOOK_BY_NO.get(bookNo)
  const scrollRef = useRef<HTMLElement | null>(null)
  const assignScroll = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el
  }, [])
  const ohKey = headingAnchor ? `${headingAnchor.verse}.${headingAnchor.segment}` : ''
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
    if (!data || (firstHlVerse == null && !ohKey)) return
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
      scrollRef.current?.scrollIntoView({
        block: 'center',
        behavior: chapterChanged ? 'auto' : 'smooth',
      })
    })
    return () => cancelAnimationFrame(id)
  }, [data, bookNo, chapterNo, firstHlVerse, ohKey])

  if (error) {
    return <p className="p-8 text-sm text-destructive">資料載入失敗：{error}</p>
  }
  if (!data) {
    return <p className="p-8 text-sm text-muted-foreground">載入中…</p>
  }
  if (!book) {
    return <p className="p-8 text-sm text-muted-foreground">找不到書卷</p>
  }

  const chapter = findChapter(data, bookNo, chapterNo)
  const outlineMap = showOutline
    ? chapterOutlineByAnchor(outline, bookNo, chapterNo)
    : new Map<string, OutlineEntry[]>()

  // First tap (0 → 1 selected) recenters the verse so the floating bar that
  // appears at the bottom doesn't hide it; later taps just toggle. The scroll
  // is deferred a frame so the extra bottom padding (added on this same render)
  // exists first — otherwise the last verses have no room to move up.
  const selectVerse = (verse: number, el: Element | null) => {
    const wasEmpty = selected.size === 0
    toggleSelect(verse)
    if (wasEmpty && el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
  }

  // Both a tap and a ~500ms long-press select a verse. The pointer handlers run
  // the long-press timer (cancelled once the finger moves past a few px = a
  // scroll); a quick tap is handled on click. The `long` flag stops the trailing
  // click from toggling the verse straight back off after a long-press fired.
  const versePress = (verse: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      const el = e.currentTarget
      const st = { x: e.clientX, y: e.clientY, long: false, timer: 0 }
      st.timer = window.setTimeout(() => {
        st.long = true
        selectVerse(verse, el)
      }, 500)
      pressRef.current = st
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = pressRef.current
      if (st && (Math.abs(e.clientX - st.x) > 10 || Math.abs(e.clientY - st.y) > 10)) {
        clearTimeout(st.timer)
        pressRef.current = null
      }
    },
    onPointerUp: () => {
      const st = pressRef.current
      if (st) clearTimeout(st.timer)
    },
    onPointerCancel: () => {
      const st = pressRef.current
      if (st) clearTimeout(st.timer)
      pressRef.current = null
    },
    onClick: (e: React.MouseEvent) => {
      const st = pressRef.current
      pressRef.current = null
      if (st?.long) return // long-press already selected; ignore the click
      selectVerse(verse, e.currentTarget)
    },
  })

  const selectedText = () =>
    (chapter?.verses ?? [])
      .filter((v) => selected.has(v.verse))
      .map((v) => `${formatVerseRef(bookNo, chapterNo, v.verse, citeFormat)}『${v.text}』`)
      .join('\n')

  const exitSelection = () => {
    setSelected(new Set())
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

      const pushHeading = (e: OutlineEntry, key: string, seg: number) => {
        const isTarget =
          headingAnchor != null && headingAnchor.verse === v.verse && headingAnchor.segment === seg
        const takeRef = isTarget && !headingRefDone
        if (takeRef) headingRefDone = true
        rows.push({
          kind: 'heading',
          entry: e,
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
      const verseNotes = annChapter?.verses.find((x) => x.verse === v.verse)?.notes

      if (anyMid && v.segments) {
        let off = 0
        const lastSeg = v.segments.length - 1
        v.segments.forEach((segText, s) => {
          headingsAt(s).forEach((e, i) => pushHeading(e, `h${v.verse}-${s}-${i}`, s))
          rows.push({
            kind: 'verse',
            verse: v.verse,
            num: s === 0 && v.verse !== 0 ? v.verse : '',
            text: segText,
            en: s === lastSeg ? enText : undefined,
            marks: sliceMarks(v.marks, off, off + segText.length),
            hl,
            ref: isFirst && s === 0,
            key: `v${v.verse}-${s}`,
          })
          off += segText.length
        })
      } else {
        headingsAt(0).forEach((e, i) => pushHeading(e, `h${v.verse}-${i}`, 0))
        rows.push({
          kind: 'verse',
          verse: v.verse,
          num: v.verse === 0 ? '' : v.verse,
          text: v.text,
          en: enText,
          marks: v.marks,
          notes: verseNotes,
          hl,
          ref: isFirst,
          key: `v${v.verse}`,
        })
      }
    }
  }

  return (
    <>
      <ReaderFrame
        title={
          <>
            {book.name}{' '}
            <span className="text-muted-foreground">
              第 {chapterNo} {chapterUnit(bookNo)}
            </span>
          </>
        }
        leftAction={leftAction}
        rightAction={rightAction}
        onSwipePrev={onSwipePrev}
        onSwipeNext={onSwipeNext}
        prevLabel={prevLabel}
        nextLabel={nextLabel}
        swipeKey={`${bookNo}/${chapterNo}`}
        swipeEnabled={selected.size === 0}
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
          selected.size > 0
            ? 'pb-[calc(1.5rem+3.5rem+0.75rem)] duration-0'
            : 'duration-300',
        )}
      >
        {/* TODO: 展開/收起所有註釋 — toggleAll + allExpanded are wired up
         * and ready (see useMemo above); UI is hidden until we decide on a
         * better entry point than a top-right text button. */}
        {chapter ? (
        <div className="grid grid-cols-[minmax(1.3125rem,auto)_1fr] gap-x-2 gap-y-2.5 font-serif text-[length:var(--reading-fs,1rem)]">
          {rows.map((r) =>
            r.kind === 'heading' ? (
              <OutlineHeading
                key={r.key}
                entry={r.entry}
                tight={r.tight}
                highlight={r.hl}
                innerRef={r.ref ? assignScroll : undefined}
              />
            ) : (
              <Fragment key={r.key}>
                <span
                  ref={r.ref ? assignScroll : undefined}
                  {...versePress(r.verse)}
                  className="pt-1 text-right text-xs font-sans text-muted-foreground select-none"
                >
                  {r.num}
                </span>
                <div
                  {...versePress(r.verse)}
                  className="select-none [-webkit-touch-callout:none]"
                >
                  <p
                    className={cn(
                      'rounded px-1 -mx-1 font-medium leading-relaxed',
                      r.hl && 'bg-highlight',
                      selected.has(r.verse) && 'bg-blue-500/20 dark:bg-blue-400/25',
                    )}
                  >
                    {renderMarkedText(r.text, r.marks, r.notes, (n) => {
                      // A long-press over a note already selected the verse —
                      // don't also open the note.
                      if (pressRef.current?.long) {
                        pressRef.current = null
                        return
                      }
                      toggleNote(r.verse, n)
                    })}
                  </p>
                  {r.en && (
                    <p className="mt-0.5 font-sans text-[0.9em] text-muted-foreground">{r.en}</p>
                  )}
                  {/* Only the notes the user has actually expanded via sup
                   * tap are rendered inline — keeps the reading surface clean
                   * until they ask for the detail. */}
                  {r.notes && (
                    <NoteList
                      notes={r.notes.filter((n) =>
                        expandedNotes.has(`${r.verse}:${n.n}`),
                      )}
                      bookNo={bookNo}
                      chapterNo={chapterNo}
                      highlightedNs={
                        new Set(
                          r.notes
                            .filter((n) => noteHighlights.has(`${r.verse}:${n.n}`))
                            .map((n) => n.n),
                        )
                      }
                    />
                  )}
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
      </ReaderFrame>

      {/* Non-modal selection card (no overlay) so the verses behind it stay
       * tappable and you can keep adding to the selection. Floats above the
       * bottom nav on mobile; a bottom-right toast on desktop (matching the
       * update prompt). */}
      {selected.size > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(var(--nav-h)+0.75rem)] z-40 flex h-14 items-center gap-3 rounded-xl border border-border bg-popover/95 px-4 pr-2.5 text-sm shadow-lg backdrop-blur md:inset-x-auto md:right-3 md:bottom-3 md:min-w-[320px] md:max-w-sm">
          <span className="text-sm text-muted-foreground">已選 {selected.size} 節</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={copySelected}
              disabled={selected.size === 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95 disabled:opacity-50"
            >
              複製
            </button>
            <button
              type="button"
              onClick={shareSelected}
              disabled={selected.size === 0}
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95 disabled:opacity-50"
            >
              分享
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
        </div>
      )}
    </>
  )
}
