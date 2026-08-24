import { useRef, useState } from 'react'
import { Scan } from 'lucide-react'
import { citationsOnly, tidyScanned } from '@/lib/scannedText'
import { useScanner } from '@/lib/scanner'
import { cn } from '@/lib/utils'


/** 清除 / 貼上 (and optionally 掃描) for a textarea.
 *
 * Two looks. The default `plain` variant is a couple of small grey pills that
 * float over the corner of the field — what the compose editor wants. The `bar`
 * variant is a full-width row of coloured icon buttons that sit in the flow
 * below the field, which is the search page's look; there 清除 always shows (so
 * the row doesn't reflow as the field fills) while `plain` only shows it when
 * there's text to clear. `className` replaces the default positioning outright. */
export function InputActions({
  value,
  onChange,
  focusRef,
  className,
  btnClassName,
  scan,
  variant = 'plain',
}: {
  value: string
  onChange: (v: string) => void
  focusRef: React.RefObject<HTMLTextAreaElement | null>
  className?: string
  /** Override the pill size/text (plain variant only). Defaults to the compact
   * search-page size; the compose panel passes the larger 完成-matching size. */
  btnClassName?: string
  /** Offer 掃描 as well: photograph a page and read the citations off it. Only
   * where a whole outline is worth pasting — the 經節 search input and nowhere
   * else, since a scan yields citations, not keywords or prose. */
  scan?: boolean
  /** `plain` = corner pills (compose). `bar` = full-width coloured icon row
   * under the field (search). */
  variant?: 'plain' | 'bar'
}) {
  const canPaste =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

  const fileRef = useRef<HTMLInputElement>(null)
  const openScanner = useScanner()
  // 讀取中 while the model loads and runs — the first scan of a session fetches
  // about 6 MB, so this can be a few seconds with nothing else to show for it.
  const [reading, setReading] = useState(false)
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReading(true)
    try {
      const { scanPhoto } = await import('@/lib/scanPhoto')
      const text = await scanPhoto(file)
      if (text) {
        onChange(text)
        focusRef.current?.focus()
      }
    } catch {
      /* no camera, or nothing legible — leave the box as it was */
    } finally {
      setReading(false)
    }
  }

  const clear = () => {
    onChange('')
    focusRef.current?.focus()
  }
  const paste = async () => {
    try {
      // Several lines at once is a page that was photographed, not something
      // typed — the phone's own text recognition, most likely, which is as good
      // as ours. Same treatment: tidy its habits, keep the citations.
      const page = tidyScanned(await navigator.clipboard.readText())
      const text = page.includes('\n') ? citationsOnly(page) || page : page
      if (text) {
        onChange(text)
        focusRef.current?.focus()
      }
    } catch {
      /* clipboard read denied / unavailable */
    }
  }

  // A live viewfinder where there is a camera to open; the picker is what is
  // left on a desktop, and what a refused permission falls back to. No focus
  // afterwards on the live path: the keyboard would come up over the results
  // the scan just went and fetched.
  const runScan = () =>
    openScanner && typeof navigator.mediaDevices?.getUserMedia === 'function'
      ? openScanner(onChange)
      : fileRef.current?.click()

  // capture=environment asks for the back camera and the system's own
  // viewfinder; on a desktop it falls back to the file picker.
  const fileInput = scan && (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      capture="environment"
      onChange={onFile}
      className="hidden"
    />
  )

  if (variant === 'bar') {
    // A left-aligned row of small grey text pills below the field — the same
    // secondary colour the rest of the app's buttons use. Natural width, not
    // stretched, so they stay compact.
    const barBtn =
      'rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95 disabled:opacity-60'
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {fileInput}
        {canPaste && (
          <button type="button" onClick={paste} className={barBtn}>
            貼上
          </button>
        )}
        <button type="button" onClick={clear} className={barBtn}>
          清除
        </button>
        {scan && (
          <button
            type="button"
            disabled={reading}
            onClick={runScan}
            className={cn(barBtn, reading && 'animate-pulse')}
          >
            掃描
          </button>
        )}
      </div>
    )
  }

  const btn = cn(
    'rounded-lg bg-secondary font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95',
    btnClassName ?? 'px-4 py-2 text-sm',
  )

  return (
    <div className={cn('flex items-center gap-2', className ?? 'absolute right-2 bottom-2')}>
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
      {scan && (
        <>
          {fileInput}
          <button
            type="button"
            disabled={reading}
            aria-label="掃描"
            onClick={runScan}
            // Square, and the same 36px the text pills come to beside it
            // (py-2 either side of a text-sm line box) — an icon in a pill
            // shaped like a word reads as a word that failed to load. `reading`
            // only happens on the picker path, where there is a wait with
            // nothing else to show for it.
            className={cn(
              btn,
              'inline-flex size-9 items-center justify-center p-0',
              reading && 'animate-pulse opacity-60',
            )}
          >
            {/* Lighter than lucide's default 2, matching the nav icons — at this
              * size the heavier line reads as clumsy. */}
            <Scan className="size-5 [stroke-width:1.6]" />
          </button>
        </>
      )}
    </div>
  )
}
