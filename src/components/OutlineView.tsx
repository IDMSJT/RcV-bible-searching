import { useLayoutEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { useOutline } from '@/data/loadBible'
import { formatOutlineRange, displayMarker } from '@/lib/chinese'

/** The book-outline body as a carousel panel (own vertical scroll). Mirrors the
 * chapter panel's shell so the pager can render either interchangeably. */
export function OutlineView({ bookNo, active = false }: { bookNo: number; active?: boolean }) {
  const { data: outline } = useOutline()
  const entries = outline?.books.find((b) => b.bookNo === bookNo)?.outline ?? []
  const panelRef = useRef<HTMLDivElement>(null)

  // Re-assert this panel's own scroll across the next frames so a freshly-mounted
  // container can't keep a neighbour's offset — iOS WKWebView (installed PWA)
  // restores it AFTER our layout effect. Same treatment as ChapterView. Only the
  // active panel records its position. entries.length re-runs it once data lands.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
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
  }, [active, bookNo, entries.length])

  return (
    <div
      ref={panelRef}
      className="h-full overflow-y-auto overscroll-contain pb-[var(--nav-h)] [overflow-anchor:none] md:pb-0"
    >
      <article className="mx-auto max-w-3xl px-[2.8125rem] py-6 md:px-[3.8125rem] md:py-10">
        <div className="flex flex-col gap-y-2.5 font-sans text-[length:calc(var(--reading-fs,1rem)*0.875)]">
          {entries.map((e, i) => (
            <Link
              key={i}
              to="/$bookNo/$chapterNo"
              params={{ bookNo, chapterNo: e.anchor.chapter }}
              search={
                e.anchor.verse
                  ? { oh: `${e.anchor.verse}${e.anchor.segment ? `.${e.anchor.segment}` : ''}` }
                  : {}
              }
              style={{ paddingLeft: `${(e.level - 1) * 0.5}rem` }}
              className="group block pr-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="inline-block rounded px-1 -mx-1 transition-colors group-hover:bg-muted">
                {e.marker && <span className="mr-1.5">{displayMarker(e.marker)}</span>}
                {e.title}
                {e.continued && ' (續)'}
                {e.range && (
                  <span className="ml-1.5 text-muted-foreground/60">{formatOutlineRange(e.range)}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      </article>
    </div>
  )
}
