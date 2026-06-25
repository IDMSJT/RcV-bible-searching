import { cn } from '@/lib/utils'

/** Floating 清除 / 貼上 pills for a textarea. `clear` only shows when there's
 * text; `貼上` only when the Clipboard read API exists. `className` overrides
 * the container position so callers can dodge other floating buttons (e.g. the
 * compose panel's 完成 FAB sits bottom-right, so its actions live bottom-left). */
export function InputActions({
  value,
  onChange,
  focusRef,
  className,
  btnClassName,
}: {
  value: string
  onChange: (v: string) => void
  focusRef: React.RefObject<HTMLTextAreaElement | null>
  className?: string
  /** Override the pill size/text. Defaults to the compact search-page size;
   * the compose panel passes the larger 完成-matching size. */
  btnClassName?: string
}) {
  const canPaste =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

  const clear = () => {
    onChange('')
    focusRef.current?.focus()
  }
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        onChange(text)
        focusRef.current?.focus()
      }
    } catch {
      /* clipboard read denied / unavailable */
    }
  }

  const btn = cn(
    'rounded-lg bg-secondary font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95',
    btnClassName ?? 'px-4 py-2 text-sm',
  )

  return (
    <div className={cn('absolute flex items-center gap-2', className ?? 'right-2 bottom-2')}>
      {value && (
        <button type="button" onClick={clear} className={btn}>
          清除
        </button>
      )}
      {canPaste && (
        <button type="button" onClick={paste} className={btn}>
          貼上
        </button>
      )}
    </div>
  )
}
