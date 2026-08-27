import { Fragment, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  useBible,
  useAnnotations,
  findChapter,
  notesForVerse,
} from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { displayMarker } from '@/lib/chinese'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { parseStudyLines, type StudyLine, type StudySegment, type VerseRef } from '@/lib/studyParse'
import { renderMarkedText, renderNoteText } from '@/lib/renderVerse'
import { ScrollBody } from '@/components/ScrollBody'
import { ACTION_BAR_CLS, ACTION_BAR_BTN, ACTION_BAR_BTN_PRIMARY } from '@/lib/chrome'
import { cn } from '@/lib/utils'
import type { Annotation, AnnotationData, Bible, Mark } from '@/types/bible'

export const Route = createFileRoute('/compose')({
  component: ComposePage,
})

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
}

// A clause split can strand a quotation mark whose partner sits in the cut-off
// half (林前15:45下 starts with the 」 that closed 「…活的魂」). Strip quote /
// bracket punctuation flush against a clipped edge — closing marks at a front
// cut, opening marks at a back cut — so the fragment reads cleanly.
const LEAD_CLIP_RE = /^[）)」』》〉”’"']+/
const TAIL_CLIP_RE = /[（(「『《〈“‘"']+$/

function segmentText(text: string, seg: number): string {
  // 上 / 下 split the verse in two on a clause separator; 中 expects three parts
  // and takes the middle. Prefer the semantic separators 。/；, fall back to ！/!
  // for verses whose boundary is a shout. An ellipsis marks whichever side was
  // clipped — trailing after 上, leading before 下, both around 中 — so the reader
  // sees it's a fragment. If the split doesn't yield the expected part count the
  // boundary is unknown, so return the whole verse unmarked.
  const want = seg === 2 ? 3 : 2 // 中 needs three parts, 上/下 need two
  const idx = seg === 2 ? 1 : seg // 中 → middle of 3; 上/下 → 0/1 of 2
  for (const re of [/(?<=[。；])/, /(?<=[！!])/]) {
    const parts = text.split(re).filter((s) => s.trim())
    if (parts.length !== want) continue
    const piece = parts[idx]
    if (piece == null) return text
    const head = idx > 0 ? '…' : ''
    const tail = idx < parts.length - 1 ? '…' : ''
    let body = piece
    if (head) body = body.replace(LEAD_CLIP_RE, '')
    if (tail) body = body.replace(TAIL_CLIP_RE, '')
    return head + body + tail
  }
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
        const vNotes = notesForVerse(annotations, r.bookNo, c, vo.verse)
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
        ? (wantsNote
            ? notesForVerse(annotations, r.bookNo, r.chapter, vo.verse)
            : []
          ).find((n) => n.n === r.note)
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
  return rows
}

/**
 * Consecutive verses read as one passage, so they are shown as one.
 *
 * A note breaks the run: it is a paragraph of commentary about the verse it
 * follows, it can't be set inline, and it belongs beside that verse rather than
 * after the whole block. Which means a range carrying a bare 註 falls back to a
 * verse at a time on its own, with no case of its own to write.
 *
 * Grouping happens inside one reference, never across two: 「太五3，六1」 is two
 * citations the reader wrote separately and they keep their own labels, even
 * where the verses would have met.
 *
 * `merge` off puts every verse back on a line of its own, labelled. Which of
 * the two a reader wants turns out to depend on what the outline is for — a
 * passage to read through, or a list to check off — so it is theirs to say.
 */
function groupRows(rows: VerseRow[], merge: boolean): VerseRow[][] {
  const out: VerseRow[][] = []
  for (const row of rows) {
    const last = out[out.length - 1]
    if (merge && !row.noteOnly && last && !last[0].noteOnly) last.push(row)
    else out.push([row])
  }
  return out
}

function verseLabel(row: VerseRow): string {
  const ab = BOOK_ABBREV[row.bookNo] ?? ''
  const s = row.seg === 0 ? '上' : row.seg === 1 ? '下' : row.seg === 2 ? '中' : ''
  const noteSuffix = row.noteOnly && row.noteToShow ? `註${row.noteToShow.n}` : ''
  return `${ab}${row.chapter}:${row.verse}${s}${noteSuffix}`
}

/** A block's own reference: one verse keeps its label, several span from the
 * first to the last. */
function blockLabel(rows: VerseRow[]): string {
  const first = rows[0]
  if (rows.length === 1) return verseLabel(first)
  const last = rows[rows.length - 1]
  const ab = BOOK_ABBREV[first.bookNo] ?? ''
  const end = last.chapter === first.chapter ? `${last.verse}` : `${last.chapter}:${last.verse}`
  return `${ab}${first.chapter}:${first.verse}-${end}`
}

/** One block as a plain-text line for copying — the passage run together under
 * its own reference. No verse numbers in here: the label already says which
 * verses these are, and what gets pasted into a document should read as the
 * prose it is. */
function blockToText(rows: VerseRow[]): string {
  const first = rows[0]
  const text =
    first.noteOnly && first.noteToShow
      ? first.noteToShow.text
      : rows.map((r) => r.text).join('')
  return `${blockLabel(rows)}　${text}`
}

/** Serialise the rendered outline (titles, headings, points + their filled-in
 * verses) to plain text — what the 複製 button puts on the clipboard. */
function buildComposeText(
  parsed: StudyLine[],
  lines: string[],
  bible: Bible | null,
  annotations: AnnotationData | null,
  merge: boolean,
): string {
  const titleTexts = parsed.flatMap((p) => (p.kind === 'title' ? [p.text] : []))
  const firstTitleIdx = parsed.findIndex((p) => p.kind === 'title')
  const out: string[] = []
  const pushVerses = (refs: VerseRef[]) => {
    if (!bible) return
    for (const r of refs)
      for (const rows of groupRows(expandRef(bible, annotations, r), merge))
        out.push('　' + blockToText(rows))
  }
  parsed.forEach((p, i) => {
    if (p.kind === 'empty') return
    if (p.kind === 'title') {
      if (i === firstTitleIdx) out.push(titleTexts.join('\n'))
    } else if (p.kind === 'week') {
      out.push(lines[i].trim())
    } else if (p.kind === 'reading') {
      out.push(p.text)
      pushVerses(p.refs)
    } else {
      out.push(p.lead + p.segments.map((s) => s.text).join(''))
      pushVerses(p.refs)
    }
  })
  return out.join('\n')
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
  merge,
}: {
  refs: VerseRef[]
  bible: Bible
  annotations: AnnotationData | null
  merge: boolean
}) {
  const blocks = refs.flatMap((r) => groupRows(expandRef(bible, annotations, r), merge))
  if (blocks.length === 0) return null
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
      {blocks.map((rows, j) => (
        <BlockItem key={j} rows={rows} />
      ))}
    </div>
  )
}

function BlockItem({ rows }: { rows: VerseRow[] }) {
  const first = rows[0]
  const last = rows[rows.length - 1]
  // URL hl form mirrors the LookupPanel:
  //   range         → 「v-v」 (same chapter) or 「chA:vA-chB:vB」 (cross-chapter)
  //   direct note   → 「verse:n」      (only the note tinted+expanded)
  //   plain verse   → 「verse」
  const hl =
    rows.length > 1
      ? last.chapter !== first.chapter
        ? `${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`
        : `${first.verse}-${last.verse}`
      : first.noteOnly && first.noteToShow
        ? `${first.verse}:${first.noteToShow.n}`
        : String(first.verse)
  return (
    <Fragment>
      <Link
        to="/$bookNo/$chapterNo"
        params={{ bookNo: first.bookNo, chapterNo: first.chapter }}
        search={{ hl }}
        className="self-start whitespace-nowrap pt-0.5 text-left text-[0.75em] font-sans text-muted-foreground transition-colors hover:text-foreground"
      >
        {blockLabel(rows)}
      </Link>
      {first.noteOnly && first.noteToShow ? (
        // Direct 注N row — note body where verse text would go, paragraphs
        // following the EPUB's restored breaks. Same column treatment as a
        // verse so a note row lays out identically to a verse row.
        <div>
          {first.noteToShow.text.split('\n').map((para, i) => (
            <p key={i} className="text-foreground/90">
              {renderNoteText(para, { book: first.bookNo, chapter: first.chapter })}
            </p>
          ))}
        </div>
      ) : (
        // One passage, one paragraph. The verse numbers ride along as
        // superscripts, the way the reading page sets them — the only thing a
        // verse of its own bought was knowing where each one starts, and this
        // keeps that without spending a row on it. A number carries its chapter
        // too where the run crosses into one, or 25:46 would be followed by a
        // bare 1. The first is left bare: the label beside it already opens with
        // the same number.
        <p className="text-foreground/90">
          {rows.map((row, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <sup className="mx-px font-sans text-[0.7em] text-muted-foreground">
                  {row.chapter !== rows[i - 1].chapter
                    ? `${row.chapter}:${row.verse}`
                    : row.verse}
                </sup>
              )}
              {renderMarkedText(row.text, row.marks)}
            </Fragment>
          ))}
        </p>
      )}
    </Fragment>
  )
}

function ComposePage() {
  const [input] = useLocalStorage('rcv/compose-input', '')
  // Whether a range reads as one passage or as a verse a line. Kept here rather
  // than in 設定: it only ever changes this page, and a setting the reader can't
  // see the effect of while they flip it is a setting they have to go and check.
  const [merge, setMerge] = useLocalStorage('rcv/compose-merge', true)
  const { data: bible } = useBible()
  // Annotations are always loaded — they only get surfaced for refs that
  // explicitly request a note (太一21注3), so this isn't gated on 顯示註釋.
  const { data: annotations } = useAnnotations()
  const lines = input.split('\n')
  const parsed = useMemo(() => parseStudyLines(input), [input])

  if (input.trim() === '') {
    return (
      <ScrollBody className="min-h-0 flex-1 print:overflow-visible print:pb-0">
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

  const copyText = async () => {
    const text = buildComposeText(parsed, lines, bible, annotations, merge)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard denied */
    }
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
    <ScrollBody className="min-h-0 flex-1 print:overflow-visible print:pb-0">
    {/* min-h-full + a flex-1 article pushes the docked bar to the foot even when
      * the outline is short, the same way the search results seat their bar. */}
    <div className="flex min-h-full flex-col">
    <article className="relative mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-8 md:py-10">
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
                {p.refs.length > 0 && bible && <VerseList refs={p.refs} bible={bible} annotations={annotations} merge={merge} />}
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
          // The marker is stripped at parse time, so the segments are already
          // just the body and can render straight into the second column.
          const renderSegments = p.segments.map((seg, k) =>
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
                  <p className="font-medium">{displayMarker(p.marker)}</p>
                  <p className="font-medium">{renderSegments}</p>
                </div>
              ) : (
                <p className="font-medium">{renderSegments}</p>
              )}
              {p.refs.length > 0 && bible && (
                <div style={{ paddingLeft: '2rem' }}>
                  <VerseList refs={p.refs} bible={bible} annotations={annotations} merge={merge} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </article>
    {/* 複製 + 列印 on the same docked row the search results use. Sticky inside
     * the scroller, not fixed to the viewport: on the wide layout a fixed bar
     * would span the sidebar too. At the foot of the scroll it's simply the last
     * thing there, so it reserves no padding under the last line. */}
    <div className={cn('sticky bottom-0 z-40 gap-2 print:hidden', ACTION_BAR_CLS)}>
      {/* Labelled with what it will do rather than with what is on, so it can
       * dress as the action it is and sit beside 複製 without a second visual
       * vocabulary for the reader to learn. Which also means no aria-pressed:
       * the label already changes, and a toggle that announces both its state
       * and its opposite says one of them backwards. */}
      <button
        type="button"
        onClick={() => setMerge(!merge)}
        className={cn('mr-auto', ACTION_BAR_BTN)}
      >
        {merge ? '分離經節' : '合併經節'}
      </button>
      <button type="button" onClick={copyText} className={ACTION_BAR_BTN}>
        複製
      </button>
      <button type="button" onClick={() => window.print()} className={ACTION_BAR_BTN_PRIMARY}>
        列印
      </button>
    </div>
    </div>
    </ScrollBody>
  )
}
