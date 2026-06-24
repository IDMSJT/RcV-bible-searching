import { Fragment, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  useBible,
  useAnnotations,
  findChapter,
  findAnnotationChapter,
} from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { parseStudyLines, type StudySegment, type VerseRef } from '@/lib/studyParse'
import { renderMarkedText, renderNoteText, NoteList } from '@/lib/renderVerse'
import { ScrollBody } from '@/components/ScrollBody'
import type { Annotation, AnnotationData, Bible, Mark } from '@/types/bible'

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
  /** Only present for un-segmented verses — splitting on 上/下 would
   * desynchronise mark offsets from the truncated text. */
  marks?: Mark[]
  /** Single note the source ref asked for via 注N. Shown unconditionally
   * below the verse — never derived from "every note this verse happens
   * to have". */
  noteToShow?: Annotation
  /** True when the source ref attached the note directly (no connector) —
   * 「啟二一23註1」. The row then renders the note BODY as its main content
   * instead of the verse text, and the label gains a 註N suffix. */
  noteOnly?: boolean
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

function expandRef(bible: Bible, annotations: AnnotationData | null, r: VerseRef): VerseRow[] {
  const single = r.chapter === r.endChapter && r.verseStart === r.verseEnd
  // Only single-verse refs can attach a specific note — a range can't say
  // which verse the 「注N」 belongs to.
  const wantsNote = single && r.note != null
  const annCh = wantsNote ? findAnnotationChapter(annotations, r.bookNo, r.chapter) : null
  const rows: VerseRow[] = []
  for (let c = r.chapter; c <= r.endChapter; c++) {
    const ch = findChapter(bible, r.bookNo, c)
    if (!ch) continue
    const from = c === r.chapter ? r.verseStart : 1
    const to = c === r.endChapter ? r.verseEnd : Infinity
    for (const vo of ch.verses) {
      if (vo.verse < from || vo.verse > to || vo.verse === 0) continue
      const seg = single ? r.seg : null

      // Bare 註 (noteAll): every footnote on this verse → its own note row.
      // Connected form (太八2與註) also emits the verse row first.
      if (r.noteAll) {
        const vNotes =
          findAnnotationChapter(annotations, r.bookNo, c)?.verses.find(
            (x) => x.verse === vo.verse,
          )?.notes ?? []
        if (!r.noteDirect) {
          rows.push({
            bookNo: r.bookNo,
            chapter: c,
            verse: vo.verse,
            seg,
            text: seg != null ? segmentText(vo.text, seg) : vo.text,
            marks: seg == null ? vo.marks : undefined,
          })
        }
        for (const note of vNotes) {
          rows.push({
            bookNo: r.bookNo,
            chapter: c,
            verse: vo.verse,
            seg: null,
            text: '',
            noteToShow: note,
            noteOnly: true,
          })
        }
        continue
      }

      const isAttachedVerse = wantsNote && c === r.chapter && vo.verse === r.verseStart
      const noteToShow = isAttachedVerse
        ? annCh?.verses.find((x) => x.verse === vo.verse)?.notes.find((n) => n.n === r.note)
        : undefined

      // Direct 注N → only emit the note row (no verse row).
      if (isAttachedVerse && r.noteDirect) {
        if (!noteToShow) continue
        rows.push({
          bookNo: r.bookNo,
          chapter: c,
          verse: vo.verse,
          seg: null,
          text: '',
          noteToShow,
          noteOnly: true,
        })
        continue
      }

      // Verse row (default).
      rows.push({
        bookNo: r.bookNo,
        chapter: c,
        verse: vo.verse,
        seg,
        text: seg != null ? segmentText(vo.text, seg) : vo.text,
        marks: seg == null ? vo.marks : undefined,
      })

      // Connected 注N → add an extra note-only row right after the verse,
      // so the outline shows both as siblings (same way the lookup panel
      // splits them).
      if (isAttachedVerse && !r.noteDirect && noteToShow) {
        rows.push({
          bookNo: r.bookNo,
          chapter: c,
          verse: vo.verse,
          seg: null,
          text: '',
          noteToShow,
          noteOnly: true,
        })
      }
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
  const noteSuffix = row.noteOnly && row.noteToShow ? `註${row.noteToShow.n}` : ''
  return `${ab}${row.chapter}:${row.verse}${s}${noteSuffix}`
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

function VerseList({
  refs,
  bible,
  annotations,
}: {
  refs: VerseRef[]
  bible: Bible
  annotations: AnnotationData | null
}) {
  const rows = refs.flatMap((r) => expandRef(bible, annotations, r))
  if (rows.length === 0) return null
  return (
    <div
      className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.875em] leading-relaxed"
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
        <VerseRowItem key={j} row={row} />
      ))}
    </div>
  )
}

function VerseRowItem({ row }: { row: VerseRow }) {
  const navigate = useNavigate()
  // URL hl form mirrors the LookupPanel:
  //   collapsed range → 「v-v」 (same chapter) or 「chA:vA-chB:vB」 (cross-chapter)
  //   direct note     → 「verse:n」      (only the note tinted+expanded)
  //   connected note  → 「verse,verse:n」 (verse and note both)
  //   plain verse     → 「verse」
  const hl = row.range
    ? row.range.endChapter !== row.chapter
      ? `${row.chapter}:${row.verse}-${row.range.endChapter}:${row.range.endVerse}`
      : `${row.verse}-${row.range.endVerse}`
    : row.noteOnly && row.noteToShow
      ? `${row.verse}:${row.noteToShow.n}`
      : row.noteToShow
        ? `${row.verse},${row.verse}:${row.noteToShow.n}`
        : String(row.verse)
  return (
    <Fragment>
      <button
        type="button"
        onClick={() =>
          navigate({
            to: '/$bookNo/$chapterNo',
            params: { bookNo: row.bookNo, chapterNo: row.chapter },
            search: { hl },
          })
        }
        className="cursor-pointer self-start whitespace-nowrap pt-0.5 text-left text-[0.75em] font-sans text-muted-foreground transition-colors hover:text-foreground"
      >
        {row.range ? rangeLabel(row) : verseLabel(row)}
      </button>
      {row.range ? (
        <p className="text-muted-foreground">（共 {row.range.count} 節，點擊閱讀）</p>
      ) : row.noteOnly && row.noteToShow ? (
        // Direct 注N row — note body where verse text would go, paragraphs
        // following the EPUB's restored breaks. Same column treatment as a
        // verse so a note row lays out identically to a verse row.
        <div>
          {row.noteToShow.text.split('\n').map((para, i) => (
            <p key={i} className="text-foreground/90">
              {renderNoteText(para, { book: row.bookNo, chapter: row.chapter })}
            </p>
          ))}
        </div>
      ) : (
        <div>
          <p className="text-foreground/90">{renderMarkedText(row.text, row.marks)}</p>
          {row.noteToShow && (
            <NoteList notes={[row.noteToShow]} bookNo={row.bookNo} chapterNo={row.chapter} />
          )}
        </div>
      )}
    </Fragment>
  )
}

function ComposePage() {
  const [input] = useLocalStorage('rcv/compose-input', '')
  const { data: bible } = useBible()
  // Annotations are always loaded — they only get surfaced for refs that
  // explicitly request a note (太一21注3), so this isn't gated on 顯示註釋.
  const { data: annotations } = useAnnotations()
  const lines = input.split('\n')
  const parsed = useMemo(() => parseStudyLines(input), [input])

  if (input.trim() === '') {
    return (
      <ScrollBody>
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
      </ScrollBody>
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
    <ScrollBody>
    <article className="relative mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      {/* Floating print button — pinned to viewport bottom-right so it's always
       * reachable while scrolling. On mobile it sits just above the bottom nav
       * (nav height = 3.5rem + the iOS home-indicator safe area); desktop, where
       * there's no bottom nav, drops it to bottom-4. */}
      <button
        type="button"
        onClick={() => window.print()}
        className="fixed bottom-[calc(var(--nav-h)+0.75rem)] right-5 z-40 inline-flex items-center rounded-full bg-primary px-7 py-3.5 text-base font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:bottom-4 md:right-4 md:px-5 md:py-2.5 md:text-sm print:hidden"
      >
        列印
      </button>
      <div className="flex flex-col font-serif leading-relaxed tracking-wide text-[length:var(--reading-fs,1rem)] print:text-base">
        {lines.map((line, i) => {
          const p = parsed[i]
          if (!p || p.kind === 'empty') return null
          if (p.kind === 'title') {
            // Only render at the first title position; the rest fold in via <br>.
            if (i !== firstTitleIdx) return null
            return (
              <h1 key={i} className="pt-5 text-center text-[1.375em] font-semibold text-balance first:pt-0">
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
                {p.refs.length > 0 && bible && <VerseList refs={p.refs} bible={bible} annotations={annotations} />}
              </div>
            )
          }
          if (p.kind === 'week') {
            return (
              <h2 key={i} className="pt-4 text-center text-[0.875em] font-semibold text-muted-foreground first:pt-0">
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
                  <VerseList refs={p.refs} bible={bible} annotations={annotations} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </article>
    </ScrollBody>
  )
}
