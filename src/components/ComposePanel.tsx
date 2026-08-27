import { useRef } from 'react'
import { InputActions } from '@/components/InputActions'
import { ACTION_BAR_CLS, ACTION_BAR_BTN_PRIMARY } from '@/lib/chrome'
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
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-serif text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"

      />
      {/* 清除/貼上 at the near end, 完成 at the far one, on the docked action row
       * the rest of the app uses — a solid strip below the field rather than a
       * pill floating over it. */}
      <div className={cn('gap-2', ACTION_BAR_CLS)}>
        <InputActions value={input} onChange={setInput} focusRef={textareaRef} variant="bar" />
        {/* Mobile-only dismiss — the drawer overlays the rendered article, so
         * once the user is done editing they need a one-tap way to collapse it.
         * Hidden on desktop, where the aside is permanent. */}
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className={cn('ml-auto md:hidden', ACTION_BAR_BTN_PRIMARY)}
          >
            完成
          </button>
        )}
      </div>
    </div>
  )
}
