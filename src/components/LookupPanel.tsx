import { Fragment, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { parseRefs, segmentInput, type VerseRef } from '@/lib/parseRefs'
import { useBible, findChapter } from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { chapterNumeral } from '@/lib/chinese'
import { Textarea } from '@/components/ui/textarea'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import type { Verse } from '@/types/bible'

// Shared text/padding rules so the visible Textarea above the highlight-aware
// backdrop renders glyphs at exactly the same positions. text-base on mobile
// avoids iOS Safari's focus-zoom (which triggers below 16px).
const FIELD_CLS = 'rounded-md border px-2.5 py-2 font-serif text-base leading-relaxed md:text-sm'

const PLACEHOLDER =
  '輸入經文出處，例如：\n約翰福音一章一節，三章十六節，十四章六節'

interface ResolvedVerse {
  bookNo: number
  chapterNo: number
  verse: Verse
  ref: VerseRef
}

function refHl(ref: VerseRef): string {
  return ref.verseStart === ref.verseEnd
    ? String(ref.verseStart)
    : `${ref.verseStart}-${ref.verseEnd}`
}

function refKey(bookNo: number, chapterNo: number, hl: string): string {
  return `${bookNo}/${chapterNo}/${hl}`
}

function renderBackdrop(
  segments: { text: string; token: boolean }[],
  statuses: boolean[],
  refs: VerseRef[],
  refFound: boolean[],
  activeKey: string | null,
) {
  let tokenIndex = 0
  let refIndex = 0
  return segments.map((seg, i) => {
    if (!seg.token) return <Fragment key={i}>{seg.text}</Fragment>
    const ok = statuses[tokenIndex++] ?? true
    // Failed to parse, OR parsed but the chapter/verse doesn't exist.
    if (!ok || refFound[refIndex] === false) {
      if (ok) refIndex++
      return (
        <span key={i} className="rounded-sm bg-destructive/15 text-destructive">
          {seg.text}
        </span>
      )
    }
    const ref = refs[refIndex++]
    const isActive =
      ref != null && activeKey === refKey(ref.bookNo, ref.chapterNo, refHl(ref))
    return isActive ? (
      <span key={i} className="rounded-sm bg-highlight">
        {seg.text}
      </span>
    ) : (
      <Fragment key={i}>{seg.text}</Fragment>
    )
  })
}

export function LookupPanel({ onNavigate }: { onNavigate?: () => void } = {}) {
  const [q, setQ] = useLocalStorage('rcv/lookup-q', '')
  const { data, error } = useBible()
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

  const { refs, statuses } = useMemo(() => parseRefs(q), [q])
  const segments = useMemo(() => segmentInput(q), [q])
  const backdropRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<number | null>(null)

  const resolved = useMemo<ResolvedVerse[]>(() => {
    if (!data) return []
    const out: ResolvedVerse[] = []
    for (const ref of refs) {
      const chapter = findChapter(data, ref.bookNo, ref.chapterNo)
      if (!chapter) continue
      for (const v of chapter.verses) {
        if (v.verse >= ref.verseStart && v.verse <= ref.verseEnd) {
          out.push({ bookNo: ref.bookNo, chapterNo: ref.chapterNo, verse: v, ref })
        }
      }
    }
    return out
  }, [refs, data])

  // Per-ref: did it resolve to at least one real verse? (parsed but not found → error)
  const refFound = useMemo<boolean[]>(() => {
    if (!data) return refs.map(() => true)
    return refs.map((ref) => {
      const chapter = findChapter(data, ref.bookNo, ref.chapterNo)
      return !!chapter && chapter.verses.some((v) => v.verse >= ref.verseStart && v.verse <= ref.verseEnd)
    })
  }, [refs, data])

  const openRef = (r: ResolvedVerse) => {
    navigate({
      to: '/$bookNo/$chapterNo',
      params: { bookNo: r.bookNo, chapterNo: r.chapterNo },
      search: { hl: refHl(r.ref) },
    })
    // Called even when navigating to the same chapter (different verse): the
    // pathname doesn't change so the drawer's pathname-effect wouldn't fire.
    onNavigate?.()
  }

  return (
    <div className="flex flex-col md:h-full">
      <div className="border-b border-border p-3">
        <div className="relative">
          {/* Backdrop: same text, failed tokens in red */}
          <div
            ref={backdropRef}
            aria-hidden
            className={cn(
              FIELD_CLS,
              'pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words border-transparent text-foreground',
            )}
          >
            {renderBackdrop(segments, statuses, refs, refFound, activeKey)}
          </div>
          <Textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onScroll={(e) => {
              if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className={cn(
              // Override shadcn defaults so the metrics match the backdrop div
              // exactly (same padding, same font/size/leading on all viewports).
              'font-serif text-base leading-relaxed md:text-sm',
              'relative block min-h-[120px] w-full resize-y break-words bg-transparent text-transparent caret-foreground',
            )}
          />
        </div>
      </div>

      <div className="p-3 md:flex-1 md:overflow-y-auto">
        {error ? (
          <p className="text-sm text-destructive">資料載入失敗：{error}</p>
        ) : q.trim() === '' ? (
          <p className="text-sm text-muted-foreground">輸入經文出處以查詢</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2.5 font-serif text-sm leading-relaxed">
            {resolved.map((r, i) => {
              const active =
                activeBookNo === r.bookNo &&
                activeChapterNo === r.chapterNo &&
                activeHl === refHl(r.ref)
              return (
                <ResultRow
                  key={i}
                  resolved={r}
                  active={active}
                  hover={hovered === i}
                  onHover={(h) => setHovered(h ? i : null)}
                  onClick={() => openRef(r)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ResultRow({
  resolved,
  active,
  hover,
  onHover,
  onClick,
}: {
  resolved: ResolvedVerse
  active: boolean
  hover: boolean
  onHover: (hovering: boolean) => void
  onClick: () => void
}) {
  const { bookNo, chapterNo, verse } = resolved
  const abbrev = BOOK_ABBREV[bookNo] ?? ''
  const label = `${abbrev}${chapterNumeral(chapterNo)}${verse.verse}`
  const lit = active || hover
  const handlers = {
    onClick,
    onMouseEnter: () => onHover(true),
    onMouseLeave: () => onHover(false),
  }
  return (
    <>
      <button
        type="button"
        {...handlers}
        className={cn(
          'self-start cursor-pointer whitespace-nowrap pt-1 text-left text-xs font-sans transition-colors',
          active && 'font-medium',
          lit ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </button>
      <p {...handlers} className={cn('cursor-pointer transition-colors', lit ? 'text-foreground' : 'text-foreground/90')}>
        {verse.text}
      </p>
    </>
  )
}
