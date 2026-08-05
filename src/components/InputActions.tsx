import { lazy, Suspense, useRef, useState } from 'react'
import { ScanText } from 'lucide-react'
import { citationsOnly, tidyScanned } from '@/lib/scannedText'
import { cn } from '@/lib/utils'

// The viewfinder pulls in the recogniser, so it loads on the first tap of 掃描
// and never before.
const ScanCamera = lazy(() =>
  import('@/components/ScanCamera').then((m) => ({ default: m.ScanCamera })),
)

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
  scan,
}: {
  value: string
  onChange: (v: string) => void
  focusRef: React.RefObject<HTMLTextAreaElement | null>
  className?: string
  /** Override the pill size/text. Defaults to the compact search-page size;
   * the compose panel passes the larger 完成-matching size. */
  btnClassName?: string
  /** Offer 掃描 as well: photograph a page and read the citations off it. Only
   * where a whole outline is worth pasting — not in compose, which is already
   * holding the text a scan would produce. */
  scan?: boolean
}) {
  const canPaste =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

  const fileRef = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
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
      {scan && (
        <>
          {/* capture=environment asks for the back camera and the system's own
            * viewfinder; on a desktop it falls back to the file picker. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={reading}
            aria-label="掃描"
            // A live viewfinder where there is a camera to open; the picker is
            // what is left on a desktop, and what a refused permission falls
            // back to.
            onClick={() =>
              typeof navigator.mediaDevices?.getUserMedia === 'function'
                ? setCamera(true)
                : fileRef.current?.click()
            }
            // The icon square keeps the pill's height so the row doesn't step,
            // and `reading` only happens on the picker path, where there is a
            // wait with nothing else to show for it.
            className={cn(btn, 'px-2.5', reading && 'animate-pulse opacity-60')}
          >
            <ScanText className="size-5" />
          </button>
        </>
      )}
      {camera && (
        <Suspense fallback={null}>
          <ScanCamera
            onPick={(text) => {
              setCamera(false)
              onChange(text)
              focusRef.current?.focus()
            }}
            onClose={() => setCamera(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
