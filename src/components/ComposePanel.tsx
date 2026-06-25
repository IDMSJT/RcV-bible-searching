import { useIsMobile } from '@/lib/useIsMobile'
import { useLocalStorage } from '@/lib/useLocalStorage'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-[var(--header-h)] shrink-0 items-center justify-center border-b border-border bg-muted/80 px-4 text-base font-normal backdrop-blur md:h-9 md:justify-between md:text-xs md:font-semibold'

// State lives here so typing in the textarea doesn't re-render the root.
// /compose reads the same key via useLocalStorage and stays in sync via the
// hook's same-tab subscriber.
export function ComposePanel({ onDone }: { onDone?: () => void } = {}) {
  const [input, setInput] = useLocalStorage('rcv/compose-input', '')
  const isMobile = useIsMobile()
  return (
    // `relative` so the mobile dismiss FAB below can pin to the bottom-right
    // corner of the panel. The parent wrapper already supplies `h-full
    // flex-col`, so we don't need to repeat them here.
    <div className="relative flex h-full flex-col">
      <h2 className={HEADER_CLS}><span>綱要</span></h2>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={
          isMobile
            ? '貼上綱要，下面會列出每個點的經文…'
            : '貼上綱要，右邊會列出每個點下面的經文…'
        }
        className="flex-1 resize-none bg-transparent p-4 font-serif text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"
      />
      {/* Mobile-only floating dismiss button — the drawer overlays the rendered
       * article, so once the user is done editing they need a one-tap way to
       * collapse it. Hidden on desktop where the aside is permanent. */}
      {onDone && (
        <button
          type="button"
          onClick={onDone}
          className="absolute bottom-5 right-5 inline-flex items-center rounded-full bg-primary px-7 py-3.5 text-base font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:hidden"
        >
          完成
        </button>
      )}
    </div>
  )
}
