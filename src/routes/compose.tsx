import { Fragment, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useBible, findChapter } from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { parseStudyLines, type StudySegment, type VerseRef } from '@/lib/studyParse'
import type { Bible } from '@/types/bible'

export const Route = createFileRoute('/compose')({
  component: ComposePage,
})

// Ranges longer than this collapse to a single clickable label row.
const COLLAPSE_OVER = 12

interface VerseRow {
  bookNo: number
  chapter: number
  verse: number
  seg: number | null
  text: string
  range?: { endChapter: number; endVerse: number; count: number }
}

function segmentText(text: string, seg: number): string {
  // Prefer the semantic clause separators 。/；; fall back to ！/! for verses
  // whose 上/下 boundary is a shout ("起來！我們走吧。" only has ！ before the
  // period). Only commit when the split yields exactly 2 parts — otherwise we
  // can't reliably say which half the marker means, so return the whole verse.
  const primary = text.split(/(?<=[。；])/).filter((s) => s.trim())
  if (primary.length === 2) return primary[seg] ?? text
  const fallback = text.split(/(?<=[！!])/).filter((s) => s.trim())
  if (fallback.length === 2) return fallback[seg] ?? text
  return text
}

function refResolves(bible: Bible, r: VerseRef): boolean {
  for (let c = r.chapter; c <= r.endChapter; c++) {
    if (!findChapter(bible, r.bookNo, c)) return false
  }
  const start = findChapter(bible, r.bookNo, r.chapter)
  const end = findChapter(bible, r.bookNo, r.endChapter)
  return (
    !!start &&
    !!end &&
    start.verses.some((v) => v.verse === r.verseStart) &&
    end.verses.some((v) => v.verse === r.verseEnd)
  )
}

function expandRef(bible: Bible, r: VerseRef): VerseRow[] {
  const single = r.chapter === r.endChapter && r.verseStart === r.verseEnd
  const rows: VerseRow[] = []
  for (let c = r.chapter; c <= r.endChapter; c++) {
    const ch = findChapter(bible, r.bookNo, c)
    if (!ch) continue
    const from = c === r.chapter ? r.verseStart : 1
    const to = c === r.endChapter ? r.verseEnd : Infinity
    for (const vo of ch.verses) {
      if (vo.verse < from || vo.verse > to || vo.verse === 0) continue
      const seg = single ? r.seg : null
      rows.push({
        bookNo: r.bookNo,
        chapter: c,
        verse: vo.verse,
        seg,
        text: seg != null ? segmentText(vo.text, seg) : vo.text,
      })
    }
  }
  if (rows.length > COLLAPSE_OVER) {
    return [
      {
        bookNo: r.bookNo,
        chapter: r.chapter,
        verse: r.verseStart,
        seg: null,
        text: '',
        range: { endChapter: r.endChapter, endVerse: r.verseEnd, count: rows.length },
      },
    ]
  }
  return rows
}

function verseLabel(row: VerseRow): string {
  const ab = BOOK_ABBREV[row.bookNo] ?? ''
  const s = row.seg === 0 ? '上' : row.seg === 1 ? '下' : ''
  return `${ab}${row.chapter}:${row.verse}${s}`
}

function rangeLabel(row: VerseRow): string {
  const ab = BOOK_ABBREV[row.bookNo] ?? ''
  const r = row.range!
  const end =
    r.endChapter === row.chapter ? `${r.endVerse}` : `${r.endChapter}:${r.endVerse}`
  return `${ab}${row.chapter}:${row.verse}-${end}`
}

function isRefError(seg: StudySegment, bible: Bible | null): boolean {
  if (!seg.refs) return false
  if (seg.refs.length === 0) return true
  if (!bible) return false
  return seg.refs.some((r) => !refResolves(bible, r))
}

function VerseList({ refs, bible }: { refs: VerseRef[]; bible: Bible }) {
  const navigate = useNavigate()
  const rows = refs.flatMap((r) => expandRef(bible, r))
  if (rows.length === 0) return null
  return (
    <div
      className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm leading-relaxed"
      style={{
        // scaleX is the only width-compression that actually works on system
        // fonts (font-stretch quietly no-ops without a wdth axis). The width
        // bump cancels the visual shrink at layout level so the grid still
        // fills its column instead of leaving a gap on the right.
        width: 'calc(100% / 0.92)',
        transform: 'scaleX(0.92)',
        transformOrigin: 'left center',
      }}
    >
      {rows.map((row, j) => (
        <Fragment key={j}>
          <button
            type="button"
            onClick={() =>
              navigate({
                to: '/$bookNo/$chapterNo',
                params: { bookNo: row.bookNo, chapterNo: row.chapter },
                search: { hl: String(row.verse) },
              })
            }
            className="cursor-pointer self-start whitespace-nowrap pt-0.5 text-left text-xs font-sans text-muted-foreground transition-colors hover:text-foreground"
          >
            {row.range ? rangeLabel(row) : verseLabel(row)}
          </button>
          {row.range ? (
            <p className="text-muted-foreground">（共 {row.range.count} 節，點擊閱讀）</p>
          ) : (
            <p className="text-foreground/90">{row.text}</p>
          )}
        </Fragment>
      ))}
    </div>
  )
}

function ComposePage() {
  const [input] = useLocalStorage('rcv/compose-input', '')
  const { data: bible } = useBible()
  const lines = input.split('\n')
  const parsed = useMemo(() => parseStudyLines(input), [input])

  if (input.trim() === '') {
    return (
      <article className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        <p className="text-base text-muted-foreground md:text-sm">
          <span className="md:hidden">
            點下方的綱要、貼上你的綱要，這裡會列出每個點下面的經文。
          </span>
          <span className="hidden md:inline">
            在左邊側邊欄貼上綱要，這裡就會列出每個點下面的經文。
          </span>
        </p>
      </article>
    )
  }

  // Collect every title line so we can render them as one centered <h1> with
  // <br> between, instead of a stack of separate headings.
  let firstTitleIdx = -1
  const titleTexts: string[] = []
  parsed.forEach((p, i) => {
    if (p.kind === 'title') {
      if (firstTitleIdx === -1) firstTitleIdx = i
      titleTexts.push(p.text)
    }
  })

  return (
    <article className="relative mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      {/* Floating dismiss-equivalent — pinned to viewport bottom-right so it's
       * always reachable while scrolling. The mobile offset (bottom-20) clears
       * the bottom nav bar; desktop drops it to bottom-4. */}
      <button
        type="button"
        onClick={() => window.print()}
        className="fixed bottom-20 right-5 z-40 inline-flex items-center rounded-full bg-primary px-7 py-3.5 text-base font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:bottom-4 md:right-4 md:px-5 md:py-2.5 md:text-sm print:hidden"
      >
        列印
      </button>
      <div className="flex flex-col font-serif leading-relaxed tracking-wide text-[length:var(--reading-fs,1rem)]">
        {lines.map((line, i) => {
          const p = parsed[i]
          if (!p || p.kind === 'empty') return null
          if (p.kind === 'title') {
            // Only render at the first title position; the rest fold in via <br>.
            if (i !== firstTitleIdx) return null
            return (
              <h1 key={i} className="pt-5 text-center text-[22px] font-semibold text-balance first:pt-0">
                {titleTexts.map((t, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {t}
                  </Fragment>
                ))}
              </h1>
            )
          }
          if (p.kind === 'reading') {
            return (
              <div key={i} className="pt-4 first:pt-0" style={{ paddingLeft: '2rem' }}>
                <p>{p.text}</p>
                {p.refs.length > 0 && bible && <VerseList refs={p.refs} bible={bible} />}
              </div>
            )
          }
          if (p.kind === 'week') {
            return (
              <h2 key={i} className="pt-4 text-center text-sm font-semibold text-muted-foreground first:pt-0">
                {line.trim()}
              </h2>
            )
          }
          const indent = Math.max(p.level, 1) - 1
          // Pull the marker + its trailing separator off the first segment so
          // we can render the marker in its own grid column. The MARKER_RE
          // matched on parse guarantees this prefix shape, so we always have
          // a clean split when p.marker is non-empty.
          let bodySegments = p.segments
          if (p.marker && bodySegments.length > 0) {
            const first = bodySegments[0]
            const restText = first.text.replace(/^[^　 、.．]+[　 、.．]+/, '')
            bodySegments = [{ ...first, text: restText }, ...bodySegments.slice(1)]
          }
          const renderSegments = bodySegments.map((seg, k) =>
            isRefError(seg, bible) ? (
              <span key={k} className="rounded-sm bg-destructive/15 text-destructive">
                {seg.text}
              </span>
            ) : (
              <Fragment key={k}>{seg.text}</Fragment>
            ),
          )
          return (
            <div key={i} className="pt-3 first:pt-0" style={{ paddingLeft: `${indent}rem` }}>
              {p.marker ? (
                <div className="grid grid-cols-[2rem_1fr]">
                  <p className="font-medium">{p.marker}</p>
                  <p className="font-medium">{renderSegments}</p>
                </div>
              ) : (
                <p className="font-medium">{renderSegments}</p>
              )}
              {p.refs.length > 0 && bible && (
                <div style={{ paddingLeft: '2rem' }}>
                  <VerseList refs={p.refs} bible={bible} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </article>
  )
}
