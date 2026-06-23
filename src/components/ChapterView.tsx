import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { parseRefs, type VerseRef } from '@/lib/parseRefs'
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
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import type { Annotation, Mark, OutlineEntry } from '@/types/bible'

// 人名 / 地名 單底線、補字 點底線（音譯 tl 不標）；線用淡色
const MARK_CLASS: Record<string, string> = {
  pn: 'underline decoration-1 decoration-muted-foreground/60 underline-offset-4',
  png: 'underline decoration-1 decoration-muted-foreground/60 underline-offset-4',
  add: 'underline decoration-dotted decoration-1 decoration-muted-foreground/60 underline-offset-4',
}

/** Marks overlapping [start, end), re-based to that slice. */
function sliceMarks(marks: Mark[] | undefined, start: number, end: number): Mark[] {
  if (!marks) return []
  const out: Mark[] = []
  for (const m of marks) {
    const s = Math.max(m.s, start)
    const e = Math.min(m.e, end)
    if (e > s) out.push({ k: m.k, s: s - start, e: e - start })
  }
  return out
}

function renderMarkedText(
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
          onClick={onNoteClick ? () => onNoteClick(s.n) : undefined}
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
      // Skip an overlapping mark already covered.
      if (m.e <= pos) { mIdx++; continue }
      out.push(
        <span key={`m${keyCounter++}`} className={MARK_CLASS[m.k]}>
          {text.slice(m.s, m.e)}
        </span>,
      )
      pos = m.e
      mIdx++
      continue
    }
    // Plain text up to whichever event comes first.
    const nextMarkStart = m ? m.s : text.length
    const nextSupOffset = sIdx < sups.length ? sups[sIdx].offset : text.length
    const boundary = Math.min(nextMarkStart, nextSupOffset)
    if (boundary > pos) {
      out.push(text.slice(pos, boundary))
      pos = boundary
    } else {
      // Defensive — shouldn't happen but avoid infinite loop.
      pos += 1
    }
  }
  flushSupsAt(text.length)
  return out
}

/** Scan a note paragraph for refs and render them as clickable links. The
 * surrounding prose stays plain text. Same parseRefs as LookupPanel uses, so
 * leading garbage / trailing punctuation around the ref label gets handled
 * the same way. `initialCtx` seeds book/chapter so 「十八20」 inside a Matt 1
 * note resolves to Matt 18:20 instead of dropping for lack of a book.
 *
 * Each ref renders as a <Link> rather than a JS click handler so the
 * underlying <a href> is real — right-click / cmd-click / "copy link"
 * behave the same as any other anchor. */
// Matches a "[connector]注N" / "[connector]註N" piece at the start of a prose
// segment that immediately follows a ref. The connector swallows whitespace
// plus the common Chinese joiners「、，與和及」 so 「路十八13與注1」 and
// 「啟二20，注3」 both extend the preceding link to also tint the note body.
const NOTE_SUFFIX_RE = /^([\s、，,與和及]*)([注註])\s*(\d+)/

function renderNoteText(
  text: string,
  initialCtx: { book: number; chapter: number },
): ReactNode {
  const { segments } = parseRefs(text, initialCtx)
  if (segments.length === 0) return text

  // A linkable group is the ref's text plus an optional trailing 「…注N」
  // suffix. Both get merged into ONE <Link> so the destination chapter
  // highlights the verse AND the matching note body via a single
  // `?hl=verse,verse:N` param.
  type Node =
    | { kind: 'prose'; text: string }
    | { kind: 'link'; text: string; ref: VerseRef; noteN?: number }
  const nodes: Node[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg.refs || seg.refs.length === 0) {
      nodes.push({ kind: 'prose', text: seg.text })
      continue
    }
    const ref = seg.refs[0]
    const next = segments[i + 1]
    if (next && (!next.refs || next.refs.length === 0)) {
      const m = NOTE_SUFFIX_RE.exec(next.text)
      if (m) {
        nodes.push({
          kind: 'link',
          text: seg.text + next.text.slice(0, m[0].length),
          ref,
          noteN: Number(m[3]),
        })
        const rest = next.text.slice(m[0].length)
        if (rest) nodes.push({ kind: 'prose', text: rest })
        i++
        continue
      }
    }
    nodes.push({ kind: 'link', text: seg.text, ref })
  }

  return nodes.map((node, i) => {
    if (node.kind === 'prose') return <Fragment key={i}>{node.text}</Fragment>
    const { ref, noteN } = node
    const verseRange =
      ref.verseStart === ref.verseEnd
        ? String(ref.verseStart)
        : `${ref.verseStart}-${ref.verseEnd}`
    const hl = noteN != null ? `${verseRange},${ref.verseStart}:${noteN}` : verseRange
    return (
      <Link
        key={i}
        to="/$bookNo/$chapterNo"
        params={{ bookNo: ref.bookNo, chapterNo: ref.chapter }}
        search={{ hl }}
        className="text-primary hover:text-primary/80"
      >
        {node.text}
      </Link>
    )
  })
}

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

export type HlItem =
  | { kind: 'verse'; start: number; end: number }
  | { kind: 'note'; verse: number; n: number }

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
  const verseRanges = useMemo(
    () => highlights.filter((h): h is { kind: 'verse'; start: number; end: number } => h.kind === 'verse'),
    [highlights],
  )
  const noteHighlights = useMemo(() => {
    const s = new Set<string>()
    for (const h of highlights) {
      if (h.kind === 'note') s.add(`${h.verse}:${h.n}`)
    }
    return s
  }, [highlights])

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
  // Re-read on chapter change (the lazy initializer only fires on first
  // mount, so subsequent navigations need this effect to swap in the new
  // chapter's saved set).
  const initialMountRef = useRef(true)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      return
    }
    const restored = readStorage(notesKey)
    for (const k of noteHighlights) restored.add(k)
    setExpandedNotes(restored)
  }, [notesKey, noteHighlights, readStorage])

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
  const toggleAll = useCallback(() => {
    const next = allExpanded ? new Set<string>() : new Set(allNoteKeys)
    setExpandedNotes(next)
    writeStorage(notesKey, next)
  }, [allExpanded, allNoteKeys, notesKey, writeStorage])
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
    (highlights.find((h) => h.kind === 'note') as { verse: number } | undefined)?.verse ??
    null

  useEffect(() => {
    if (!data || (firstHlVerse == null && !ohKey)) return
    scrollRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
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
        {allNoteKeys.size > 0 && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {allExpanded ? '收起所有註釋' : '展開所有註釋'}
            </button>
          </div>
        )}
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
                  {(() => {
                    const visible = r.notes?.filter((n) =>
                      expandedNotes.has(`${r.verse}:${n.n}`),
                    )
                    if (!visible || visible.length === 0) return null
                    return (
                      <ul className="mt-2 space-y-2 font-sans text-[0.95em] font-light leading-relaxed">
                        {visible.map((n) => {
                          // Split the note body on the restored paragraph
                          // breaks so we can render each as its own <p> with
                          // space-y between — `whitespace-pre-line` puts the
                          // paragraphs on separate lines but collapsed too
                          // tight; explicit <p> spacing reads better.
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
    </>
  )
}
