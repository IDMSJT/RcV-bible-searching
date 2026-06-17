import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BOOK_BY_NO } from '@/data/canon'
import { useOutline } from '@/data/loadBible'
import { formatOutlineRange, displayMarker } from '@/lib/chinese'

export const Route = createFileRoute('/$bookNo/')({
  parseParams: (raw) => ({ bookNo: Number(raw.bookNo) }),
  stringifyParams: (p) => ({ bookNo: String(p.bookNo) }),
  loader: ({ params }) => {
    const book = BOOK_BY_NO.get(params.bookNo)
    if (!book) throw notFound()
    return { book }
  },
  component: BookOutlinePage,
})

function BookOutlinePage() {
  const { bookNo } = Route.useParams()
  const { book } = Route.useLoaderData()
  const { data: outline } = useOutline()
  const entries = outline?.books.find((b) => b.bookNo === bookNo)?.outline ?? []

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-8 py-3">
          <div className="flex w-9 justify-start">
            <span className="inline-flex size-9 items-center justify-center text-muted-foreground/40">
              <ChevronLeft className="size-4" />
            </span>
          </div>
          <h1 className="text-lg font-medium tracking-tight">
            {book.name} <span className="text-muted-foreground">綱目</span>
          </h1>
          <div className="flex w-9 justify-end">
            <Link
              to="/$bookNo/$chapterNo"
              params={{ bookNo, chapterNo: 1 }}
              search={{}}
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-8 py-8">
        <div className="flex flex-col gap-y-2.5 font-sans text-sm">
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
    </>
  )
}
