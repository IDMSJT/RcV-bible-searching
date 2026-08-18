import { useRef } from 'react'
import { InputActions } from '@/components/InputActions'
import { ACTION_BAR_CLS } from '@/lib/chrome'
import { useIsMobile } from '@/lib/useIsMobile'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-[var(--header-h)] shrink-0 items-center justify-center border-b border-border bg-muted/80 px-4 text-base font-medium backdrop-blur md:h-9 md:justify-between md:text-xs md:font-semibold'

// State lives here so typing in the textarea doesn't re-render the root.
// /compose reads the same key via useLocalStorage and stays in sync via the
// hook's same-tab subscriber.
export function ComposePanel({ onDone }: { onDone?: () => void } = {}) {
  const [input, setInput] = useLocalStorage('rcv/compose-input', '')
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  return (
    // `relative` so the mobile dismiss FAB below can pin to the bottom-right
    // corner of the panel. The parent wrapper already supplies `h-full
    // flex-col`, so we don't need to repeat them here.
    <div className="relative flex h-full flex-col">
      <h2 className={HEADER_CLS}><span>綱要</span></h2>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        // The textarea fills the whole drawer; let it own its touches (caret,
        // selection, scroll) instead of fighting vaul's drag. Dismiss via the
        // header drag / 完成 button / backdrop tap.
        data-vaul-no-drag
        placeholder={
          isMobile
            ? '貼上綱要，下面會列出每個點的經文…'
            : '貼上綱要，右邊會列出每個點下面的經文…'
        }
        // pb-20 keeps the last line clear of the bar floating over it.
        className="min-h-0 flex-1 resize-none bg-transparent p-4 pb-20 font-serif text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"

      />
      {/* One bar instead of two floating corners: 清除/貼上 at the near end, 完成
       * at the far one, framed the way the search panel frames its own actions.
       *
       * Over the field, not below it. The panel is one textarea from top to
       * bottom, and a bar taking height out of the flow reads as a second pane
       * rather than as the field's own controls — which is what the frame's
       * translucency is for: the words carry on behind it. */}
      <div
        className={cn(
          'absolute inset-x-3 bottom-3 flex h-14 items-center gap-2 px-2.5 text-sm',
          ACTION_BAR_CLS,
        )}
      >
        <InputActions
          value={input}
          onChange={setInput}
          focusRef={textareaRef}
          className=""
          btnClassName="px-4 py-2 text-sm"
        />
        {/* Mobile-only dismiss — the drawer overlays the rendered article, so
         * once the user is done editing they need a one-tap way to collapse it.
         * Hidden on desktop, where the aside is permanent. */}
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95 md:hidden"
          >
            完成
          </button>
        )}
      </div>
    </div>
  )
}
