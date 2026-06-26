import { Link } from '@tanstack/react-router'
import { useOutline } from '@/data/loadBible'
import { formatOutlineRange, displayMarker } from '@/lib/chinese'

/** The book-outline body as a carousel panel (own vertical scroll). Mirrors the
 * chapter panel's shell so the pager can render either interchangeably. */
export function OutlineView({ bookNo }: { bookNo: number; active?: boolean }) {
  const { data: outline } = useOutline()
  const entries = outline?.books.find((b) => b.bookNo === bookNo)?.outline ?? []

  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-[var(--nav-h)] md:pb-0">
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
