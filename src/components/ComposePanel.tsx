import { useLocalStorage } from '@/lib/useLocalStorage'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-muted/80 px-4 text-sm font-semibold backdrop-blur md:h-8 md:text-xs'

// State lives here so typing in the textarea doesn't re-render the root.
// /compose reads the same key via useLocalStorage and stays in sync via the
// hook's same-tab subscriber.
export function ComposePanel() {
  const [input, setInput] = useLocalStorage('rcv/compose-input', '')
  return (
    <>
      <h2 className={HEADER_CLS}><span>綱要</span></h2>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="貼上綱要，右邊會列出每個點下面的經文…"
        className="flex-1 resize-none bg-transparent p-4 font-serif text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"
      />
    </>
  )
}
