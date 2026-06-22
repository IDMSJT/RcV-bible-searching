import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { Drawer as VaulDrawer } from 'vaul'
import { Copy } from 'lucide-react'
import { parseRefs, type Segment, type VerseRef } from '@/lib/parseRefs'
import { useBible, useBibleEn, findChapter } from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { BOOK_ABBREV_EN } from '@/data/abbrevEn'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/lib/useIsMobile'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import type { Verse } from '@/types/bible'

// Shared text/padding rules so the visible Textarea above the highlight-aware
// backdrop renders glyphs at exactly the same positions. text-base on mobile
// (iOS Safari's focus-zoom only kicks in below 16px), md:text-sm on desktop
// to match the rest of the sidebar panels.
const FIELD_CLS = 'p-4 font-serif text-base leading-relaxed md:text-sm'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-muted/80 px-4 text-sm font-semibold backdrop-blur md:h-9 md:text-xs'

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

export function LookupPanel({ onNavigate }: { onNavigate?: () => void } = {}) {
  const [q, setQ] = useLocalStorage('rcv/lookup-q', '')
  const { data, error } = useBible()
  const [showEnglish] = useLocalStorage('rcv/show-english', false)
  const { data: bibleEn } = useBibleEn(showEnglish)
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
  const [hovered, setHovered] = useState<number | null>(null)

  // Keep the highlight backdrop scrolled in lock-step with the textarea.
  // With `field-sizing-content` gone (fixed height), long input scrolls inside
  // the textarea — without this sync the red / hover tokens drift away from
  // the actual glyphs the user is reading.
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
  }, [])

  const resolved = useMemo<ResolvedVerse[]>(() => {
    if (!data) return []
    const out: ResolvedVerse[] = []
    for (const ref of refs) {
      const chapter = findChapter(data, ref.bookNo, ref.chapter)
      if (!chapter) continue
      // Pull the matching English chapter once per ref — findChapter is O(n)
      // over books, so caching it here keeps the per-verse loop cheap.
      const enChapter = showEnglish ? findChapter(bibleEn, ref.bookNo, ref.chapter) : null
      for (const v of chapter.verses) {
        if (v.verse >= ref.verseStart && v.verse <= ref.verseEnd) {
          const enText = enChapter?.verses.find((x) => x.verse === v.verse)?.text
          out.push({ bookNo: ref.bookNo, chapterNo: ref.chapter, verse: v, enText, ref })
        }
      }
    }
    return out
  }, [refs, data, bibleEn, showEnglish])

  // Per-ref: did it resolve to at least one real verse? (parsed but not found → error)
  const refFound = useMemo<boolean[]>(() => {
    if (!data) return refs.map(() => true)
    return refs.map((ref) => {
      const chapter = findChapter(data, ref.bookNo, ref.chapter)
      return !!chapter && chapter.verses.some((v) => v.verse >= ref.verseStart && v.verse <= ref.verseEnd)
    })
  }, [refs, data])

  // Key of the result row currently under the mouse — so its source token in
  // the input backdrop highlights along with the row's own lit state.
  const hoveredRef = hovered != null ? resolved[hovered]?.ref : null
  const hoveredKey = hoveredRef != null
    ? refKey(hoveredRef.bookNo, hoveredRef.chapter, refHl(hoveredRef))
    : null

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
      <h2 className={HEADER_CLS}><span>經節</span></h2>
      {/* Sticky on mobile so the textarea stays reachable while scrolling the
       * results below it. Desktop's aside already keeps the input visible by
       * scrolling the results in their own pane, so the sticky is a no-op
       * there. */}
      <div className="sticky top-14 z-10 border-b border-border bg-background md:static">
        <div className="relative">
          {/* Backdrop: same text, failed tokens in red */}
          <div
            ref={backdropRef}
            aria-hidden
            className={cn(
              FIELD_CLS,
              // overflow-auto (not -hidden) so our scroll-sync effect's
              // programmatic `scrollTop` actually moves the rendered tokens;
              // pointer-events-none keeps the textarea behind it the real
              // input target. Scrollbar gutter hidden because the textarea
              // already owns the visible scrollbar.
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
            className={cn(
              // Same metrics as the backdrop div so glyphs line up exactly.
              // Fixed height — the textarea scrolls internally rather than
              // pushing the results list down as the user pastes more refs.
              // FIELD_CLS supplies the padding too: shadcn's Textarea ships
              // with `px-2.5 py-2` baked in, so without re-applying it the
              // visible glyphs would sit at different x/y than the backdrop
              // and break the highlight alignment.
              FIELD_CLS,
              // [field-sizing:fixed] overrides shadcn Textarea's baked-in
              // `field-sizing-content`, otherwise the textarea would keep
              // growing to fit its value and never reach the scroll state
              // we're trying to sync the backdrop to.
              'relative block h-[120px] w-full resize-none break-words border-0 bg-transparent text-transparent caret-foreground focus-visible:ring-0 [field-sizing:fixed]',
            )}
          />
        </div>
      </div>

      <div className="p-4 md:flex-1 md:overflow-y-auto">
        {error ? (
          <p className="text-sm text-destructive">資料載入失敗：{error}</p>
        ) : q.trim() === '' ? (
          <p className="text-sm text-muted-foreground">輸入經文出處以查詢</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2.5 font-serif text-[length:var(--reading-fs,1rem)] leading-normal md:text-[length:calc(var(--reading-fs,1rem)*0.9375)]">
            {resolved.map((r, i) => {
              const active =
                activeBookNo === r.bookNo &&
                activeChapterNo === r.chapterNo &&
                activeHl === refHl(r.ref)
              return (
                <ResultRow
                  key={`${r.bookNo}-${r.chapterNo}-${r.verse.verse}-${i}`}
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
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const pressTimerRef = useRef<number | null>(null)
  const longPressedRef = useRef(false)

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])
  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }, [])
  useEffect(() => () => { clearHoverTimer(); clearPressTimer() }, [clearHoverTimer, clearPressTimer])

  const { bookNo, chapterNo, verse, enText } = resolved
  const abbrev = BOOK_ABBREV[bookNo] ?? ''
  const label = `${abbrev}${chapterNo}:${verse.verse}`
  const lit = active || hover

  const handlers = {
    // Swallow the click that immediately follows a long-press — the press
    // already opened the menu, the click would re-trigger navigation.
    onClick: () => {
      if (longPressedRef.current) {
        longPressedRef.current = false
        return
      }
      onClick()
    },
    onMouseEnter: () => {
      onHover(true)
      if (isMobile) return
      clearHoverTimer()
      hoverTimerRef.current = window.setTimeout(() => setMenuOpen(true), 500)
    },
    onMouseLeave: () => {
      onHover(false)
      if (isMobile) return
      clearHoverTimer()
      // Slight delay so the user can move the cursor onto the popover
      // without it closing under them. The popover content adds its own
      // mouseenter handler below to cancel this if they make it.
      hoverTimerRef.current = window.setTimeout(() => setMenuOpen(false), 250)
    },
    onPointerDown: () => {
      if (!isMobile) return
      longPressedRef.current = false
      clearPressTimer()
      pressTimerRef.current = window.setTimeout(() => {
        longPressedRef.current = true
        setMenuOpen(true)
        if ('vibrate' in navigator) navigator.vibrate(40)
      }, 500)
    },
    onPointerUp: clearPressTimer,
    onPointerCancel: clearPressTimer,
    // Cancel the long-press if the user starts scrolling rather than holding.
    onPointerMove: clearPressTimer,
  }

  const onPopupEnter = () => clearHoverTimer()
  const onPopupLeave = () => {
    clearHoverTimer()
    hoverTimerRef.current = window.setTimeout(() => setMenuOpen(false), 200)
  }

  return (
    <>
      <div
        ref={rowRef}
        {...handlers}
        // `select-none` suppresses the native blue text-selection that
        // appears under a long press; `[-webkit-touch-callout:none]` kills
        // iOS Safari's grey selection callout the same gesture triggers.
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
        <div>
          <p className={cn('transition-colors', lit ? 'text-foreground' : 'text-foreground/90')}>
            {verse.text}
          </p>
          {enText && (
            // Match ChapterView's English styling so the lookup result feels
            // of-a-piece with the reading surface for the same verse.
            <p className="mt-0.5 font-sans text-[0.9em] text-muted-foreground">{enText}</p>
          )}
        </div>
      </div>

      {isMobile ? (
        // NestedRoot so vaul doesn't stack-collapse the surrounding sidebar
        // drawer when we open this one on top of it.
        <VaulDrawer.NestedRoot open={menuOpen} onOpenChange={setMenuOpen}>
          <VaulDrawer.Portal>
            <VaulDrawer.Overlay className="fixed inset-0 z-[80] bg-black/40" />
            <VaulDrawer.Content className="fixed inset-x-0 bottom-0 z-[80] flex flex-col gap-1 rounded-t-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
              <VaulDrawer.Handle className="mx-auto my-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <VaulDrawer.Title className="sr-only">複製選項</VaulDrawer.Title>
              <CopyMenu resolved={resolved} onDone={() => setMenuOpen(false)} />
            </VaulDrawer.Content>
          </VaulDrawer.Portal>
        </VaulDrawer.NestedRoot>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverContent
            anchor={rowRef}
            side="right"
            align="start"
            sideOffset={8}
            className="w-44 gap-1 rounded-xl p-1.5"
            onMouseEnter={onPopupEnter}
            onMouseLeave={onPopupLeave}
          >
            <CopyMenu resolved={resolved} onDone={() => setMenuOpen(false)} />
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}

/** Three buttons that copy a single verse in different formats. The English
 * citation falls back to the Chinese abbreviation when 顯示英文 is off (no
 * `enText` available) by simply hiding the en / both options. */
function CopyMenu({ resolved, onDone }: { resolved: ResolvedVerse; onDone: () => void }) {
  const { bookNo, chapterNo, verse, enText } = resolved
  const zhLabel = `${BOOK_ABBREV[bookNo] ?? ''}${chapterNo}:${verse.verse}`
  const enLabel = `${BOOK_ABBREV_EN[bookNo] ?? ''} ${chapterNo}:${verse.verse}`

  const copy = async (format: 'zh' | 'en' | 'both') => {
    let text = ''
    if (format === 'zh') text = `${zhLabel}『${verse.text}』`
    else if (format === 'en' && enText) text = `${enLabel} "${enText}"`
    else if (format === 'both') {
      const zh = `${zhLabel}『${verse.text}』`
      text = enText ? `${zh}\n${enLabel} "${enText}"` : zh
    }
    if (!text) return
    try { await navigator.clipboard.writeText(text) } catch { /* clipboard denied */ }
    onDone()
  }

  const Item = ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button
      type="button"
      onClick={onSelect}
      // Mobile gets a taller hit-target (py-3) since the drawer is reached by
      // long-press and the buttons need to feel tappable. Desktop tightens
      // back to py-1.5 because the popover is cursor-driven.
      // active: covers touch press + desktop click — gives the tactile bg +
      // shrink feedback. transition-all so colors and transform animate
      // together; duration-150 keeps it snappy.
      className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-all duration-150 hover:bg-muted active:scale-[0.97] active:bg-muted md:py-1.5 md:text-sm"
    >
      <Copy className="size-5 shrink-0 text-muted-foreground md:size-4" strokeWidth={1.8} />
      {children}
    </button>
  )

  return (
    <div className="flex flex-col gap-0.5">
      <Item onSelect={() => copy('zh')}>複製中文</Item>
      {enText && (
        <>
          <Item onSelect={() => copy('en')}>複製英文</Item>
          <Item onSelect={() => copy('both')}>複製雙語</Item>
        </>
      )}
    </div>
  )
}
