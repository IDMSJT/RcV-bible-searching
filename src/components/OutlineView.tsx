import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BOOK_BY_NO } from '@/data/canon'
import { useOutline } from '@/data/loadBible'
import { OutlineLabel } from '@/components/OutlineLabel'
import { RefBody, type Open } from '@/lib/renderVerse'
import { cn } from '@/lib/utils'
import type { BookOutline } from '@/types/bible'

/** The book-outline body as a carousel panel (own vertical scroll). Mirrors the
 * chapter panel's shell so the pager can render either interchangeably. `oe`
 * (chapter.verse.segment) jumps to + highlights the entry a chapter heading
 * linked from — the reverse of each entry's own ?oh= link into the chapter. */
export function OutlineView({
  bookNo,
  active = false,
  oe,
}: {
  bookNo: number
  active?: boolean
  oe?: string
}) {
  const { data: outline } = useOutline()
  const book = outline?.books.find((b) => b.bookNo === bookNo)
  const entries = book?.outline ?? []
  const panelRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLElement | null>(null)

  // `oe` is the entry's index in the book outline (so an entry sharing an anchor
  // with another still resolves to exactly the one that was clicked).
  const targetIdx = oe != null && /^\d+$/.test(oe) ? Number(oe) : -1
  const isJump = active && targetIdx >= 0 && targetIdx < entries.length

  // Re-assert this panel's own scroll across the next frames so a freshly-mounted
  // container can't keep a neighbour's offset — iOS WKWebView (installed PWA)
  // restores it AFTER our layout effect. Same treatment as ChapterView. Only the
  // active panel records its position. entries.length re-runs it once data lands.
  // With `?oe=`, jump to the linked entry instead of restoring.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (isJump) {
      const raf = requestAnimationFrame(() => targetRef.current?.scrollIntoView({ block: 'start' }))
      return () => cancelAnimationFrame(raf)
    }
    const key = `rcv/scroll/o/${bookNo}`
    const reapply: number[] = []
    const saved = sessionStorage.getItem(key)
    const target = saved !== null ? Number(saved) : 0
    const apply = () => {
      el.scrollTop = target
    }
    apply()
    reapply.push(requestAnimationFrame(apply))
    reapply.push(requestAnimationFrame(() => reapply.push(requestAnimationFrame(apply))))
    if (!active) return () => reapply.forEach(cancelAnimationFrame)
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => sessionStorage.setItem(key, String(el.scrollTop)))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      reapply.forEach(cancelAnimationFrame)
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [active, bookNo, entries.length, isJump])

  return (
    <div
      ref={panelRef}
      className="h-full overflow-y-auto overscroll-y-contain scroll-pt-6 pb-[var(--nav-h)] [overflow-anchor:none] md:pb-0"
    >
      <article className="mx-auto max-w-3xl px-[2.8125rem] py-6 md:px-[3.8125rem] md:py-10">
        <BookIntro book={book} bookNo={bookNo} />
        <div className="flex flex-col gap-y-2.5 font-sans text-[length:calc(var(--reading-fs,1rem)*0.875)]">
          {entries.map((e, i) => (
            <Link
              key={i}
              ref={
                i === targetIdx
                  ? (el: HTMLElement | null) => {
                      targetRef.current = el
                    }
                  : undefined
              }
              to="/$bookNo/$chapterNo"
              params={{ bookNo, chapterNo: e.anchor.chapter }}
              search={e.anchor.verse ? { oh: String(i) } : {}}
              style={{ paddingLeft: `${(e.level - 1) * 0.5}rem` }}
              className="group block pr-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <OutlineLabel entry={e} highlight={i === targetIdx} />
            </Link>
          ))}
        </div>
      </article>
    </div>
  )
}

/** The book's own introduction, above its outline: what the book is, then who
 * wrote it, when, where and to whom — as many of those as the book carries, in
 * its own order. The subject leads the same list rather than standing apart,
 * since it reads as one more thing the book states about itself.
 *
 * Laid out as two columns so a line that wraps carries on under its own text
 * rather than back at the label. Half the books mix two- and four-character
 * labels (著者 beside 盡職時間), so the short ones are spread to the column's
 * width the way a printed table does it, and every colon falls on one line.
 *
 * The citations read like a footnote's, so the body goes through RefBody. Its
 * context is seeded with chapter 1 for a book that has only one, since 「（1。）」
 * in Philemon's introduction means its first verse and there is no chapter for
 * a bare number to inherit.
 */
function BookIntro({ book, bookNo }: { book?: BookOutline; bookNo: number }) {
  const rows = [
    ...(book?.topic ? [{ label: '主題', text: book.topic }] : []),
    ...(book?.intro ?? []),
  ]
  const topicRow = book?.topic ? 0 : -1
  const chapterNo = BOOK_BY_NO.get(bookNo)?.chapterCount === 1 ? 1 : null
  // One open reference for the whole introduction rather than one per line: it
  // reads as a single block, and two sets of verses under different lines of it
  // would be two answers to one question.
  const [open, setOpen] = useState<{ row: number; at: Open } | null>(null)
  if (rows.length === 0) return null
  return (
    <section className="mb-4 grid grid-cols-[auto_1fr] gap-y-1 border-b border-border pb-4 font-sans text-[length:calc(var(--reading-fs,1rem)*0.875)] leading-relaxed text-muted-foreground">
      {rows.map((r, i) => (
        <Fragment key={i}>
          {/* The colon sits outside the spread, so a two-character label in a
            * four-character column has its own characters pushed apart with the
            * colon still against the last of them, rather than adrift too. */}
          <span className="flex font-medium text-foreground">
            <span className="flex-1 text-justify [text-align-last:justify]">{r.label}</span>：
          </span>
          {/* The subject is what the book is; the rest is who wrote it and
            * when. It carries the weight of a heading even though it sits in
            * the same list. */}
          <div className={cn('min-w-0', i === topicRow && 'font-medium text-foreground')}>
            <RefBody
              paragraphs={[r.text]}
              bookNo={bookNo}
              chapterNo={chapterNo}
              // Only where another line follows: under the last one the
              // section's own rule already closes the introduction off, and a
              // second beside it reads as a mistake.
              continuous={i < rows.length - 1}
              open={open?.row === i ? open.at : null}
              onOpen={(at) => setOpen(at ? { row: i, at } : null)}
            />
          </div>
        </Fragment>
      ))}
    </section>
  )
}
