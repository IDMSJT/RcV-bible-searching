import { useRef } from 'react'
import { InputActions } from '@/components/InputActions'
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
        // pb-20 leaves room below the last line so the floating 清除/貼上/完成
        // buttons (pinned bottom-5) don't cover text when scrolled to the end.
        className="flex-1 resize-none bg-transparent p-4 pb-20 font-serif text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"
      />
      {/* Bottom-left so they clear the 完成 FAB pinned bottom-right. */}
      <InputActions
        value={input}
        onChange={setInput}
        focusRef={textareaRef}
        className="bottom-5 left-5"
        btnClassName="px-5 py-2.5 text-base"
      />
      {/* Mobile-only floating dismiss button — the drawer overlays the rendered
       * article, so once the user is done editing they need a one-tap way to
       * collapse it. Hidden on desktop where the aside is permanent. */}
      {onDone && (
        <button
          type="button"
          onClick={onDone}
          className="absolute right-5 bottom-5 rounded-lg bg-primary px-5 py-2.5 text-base font-medium text-primary-foreground shadow-lg transition-all duration-150 hover:bg-primary/90 active:scale-95 md:hidden"
        >
          完成
        </button>
      )}
    </div>
  )
}
