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
import { chapterUnit, formatOutlineRange, displayMarker } from '@/lib/chinese'
import { renderMarkedText, sliceMarks, NoteList } from '@/lib/renderVerse'
import type { HlItem } from '@/lib/highlight'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
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
}: {
  bookNo: number
  chapterNo: number
  /** Combined highlight list — verses to tint and / or notes to expand+tint. */
  highlights?: HlItem[]
  headingAnchor?: { verse: number; segment: number }
  leftAction?: ReactNode
  rightAction?: ReactNode
}) {
  const { data, error } = useBible()
  const { data: outline } = useOutline()
  const [showOutline] = useLocalStorage('rcv/show-outline', true)
  const [showEnglish] = useLocalStorage('rcv/show-english', false)
  const [showNotes] = useLocalStorage('rcv/show-notes', true)
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
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex w-7 justify-start">{leftAction}</div>
          <h1 className="text-base font-medium tracking-tight">
            {book.name}{' '}
            <span className="text-muted-foreground">
              第 {chapterNo} {chapterUnit(bookNo)}
            </span>
          </h1>
          <div className="flex w-7 justify-end">{rightAction}</div>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
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
                  className="pt-1 text-right text-xs font-sans text-muted-foreground"
                >
                  {r.num}
                </span>
                <div>
                  <p
                    className={cn(
                      'font-medium leading-relaxed',
                      r.hl && 'rounded bg-highlight px-1 -mx-1',
                    )}
                  >
                    {renderMarkedText(r.text, r.marks, r.notes, (n) =>
                      toggleNote(r.verse, n),
                    )}
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
    </>
  )
}
