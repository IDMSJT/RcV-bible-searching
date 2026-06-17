import { Fragment, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useBible, findChapter } from '@/data/loadBible'
import { BOOK_ABBREV } from '@/data/abbrev'
import { chapterNumeral } from '@/lib/chinese'
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
  const parts = text.split(/(?<=[。；])/).filter((s) => s.trim())
  return parts.length === 2 ? (parts[seg] ?? text) : text
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
  return `${ab}${chapterNumeral(row.chapter)}${row.verse}${s}`
}

function rangeLabel(row: VerseRow): string {
  const ab = BOOK_ABBREV[row.bookNo] ?? ''
  const r = row.range!
  const end =
    r.endChapter === row.chapter ? `${r.endVerse}` : `${chapterNumeral(r.endChapter)}${r.endVerse}`
  return `${ab}${chapterNumeral(row.chapter)}${row.verse}～${end}`
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
    <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm leading-relaxed">
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
      <article className="mx-auto max-w-3xl px-8 py-10">
        <p className="text-sm text-muted-foreground">
          在左邊側邊欄貼上綱要，這裡就會列出每個點下面的經文。
        </p>
      </article>
    )
  }

  return (
    <article className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex flex-col font-serif text-base leading-relaxed">
        {lines.map((line, i) => {
          const p = parsed[i]
          if (!p || p.kind === 'empty') return null
          if (p.kind === 'week') {
            return (
              <h2 key={i} className="pt-5 text-center text-lg font-semibold first:pt-0">
                {line.trim()}
              </h2>
            )
          }
          const indent = (Math.max(p.level, 1) - 1) * 1
          return (
            <div key={i} className="pt-3 first:pt-0" style={{ paddingLeft: `${indent}rem` }}>
              <p>
                {p.segments.map((seg, k) =>
                  isRefError(seg, bible) ? (
                    <span key={k} className="rounded-sm bg-destructive/15 text-destructive">
                      {seg.text}
                    </span>
                  ) : (
                    <Fragment key={k}>{seg.text}</Fragment>
                  ),
                )}
              </p>
              {p.refs.length > 0 && bible && <VerseList refs={p.refs} bible={bible} />}
            </div>
          )
        })}
      </div>
    </article>
  )
}
