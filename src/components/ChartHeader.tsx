import { ArrowLeft } from 'lucide-react'

// The reading header's own markup (ReadingPager), so moving from a chapter to a
// chart doesn't change the bar: same height, same title, same back button.
export function ChartHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="shrink-0 border-b border-border bg-background">
      <div className="mx-auto grid h-[var(--header-h)] max-w-3xl grid-cols-[1fr_auto_1fr] items-stretch">
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="inline-flex items-center px-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-5 [stroke-width:1.8]" />
          </button>
        </div>
        <h1 className="min-w-0 self-center text-center text-base leading-tight font-medium tracking-tight">
          {title}
        </h1>
        <div />
      </div>
    </header>
  )
}
