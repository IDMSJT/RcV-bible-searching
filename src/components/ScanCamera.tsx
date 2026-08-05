import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { citationsIn } from '@/lib/scannedText'
import { ocrService, readCanvas, type Progress } from '@/lib/scanPhoto'
import { cn } from '@/lib/utils'

/**
 * The viewfinder: point it at a reading line and the citations appear below.
 *
 * Reading a whole page takes about a second in the browser, which is fine for
 * one photograph and far too slow to do continuously. Reading a band the width
 * of one line takes about thirty milliseconds — thirty times less for the same
 * result, because what makes a page slow is the characters being small in it,
 * and a line the reader has framed fills what it is given. So the frame is a
 * band, and the reader is asked to put the line in it.
 *
 * Findings accumulate rather than replace. A hand shakes, a line takes two
 * passes to cross, and a page has more than one; keeping what has been read
 * means none of that has to be got right in a single frame.
 */
const BAND = 0.22 // of the viewfinder's height — a couple of printed lines

/** How long to wait between reads. Long enough that the interface stays
 * responsive between them, short enough to feel like it is watching. */
const EVERY_MS = 200

export function ScanCamera({ onPick, onClose }: { onPick: (q: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // What the last frame that read anything found, in the order it was printed.
  // Replaced rather than added to: a reader sweeping down a page wants what the
  // camera is on now, and appending would file each new line behind whatever
  // was read first. A frame that reads nothing leaves the last one standing, so
  // the list doesn't blink out between two good looks at the same line.
  const [found, setFound] = useState<{ key: string; text: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  // The camera opens straight away; the recogniser behind it is about 12 MB the
  // first time. Without saying so, the picture looks live and the list looks
  // broken.
  const [progress, setProgress] = useState<Progress>({ phase: 'starting' })
  // The camera is asked for once and the request is held here. In development
  // React mounts an effect, tears it down and mounts it again; without this the
  // second mount asks a second time while the first dialog is still open, and
  // the reader is prompted twice.
  const asked = useRef<Promise<MediaStream> | null>(null)
  // A pending shutdown, cancelled if the effect comes back — see the cleanup.
  const closing = useRef(0)

  useEffect(() => {
    clearTimeout(closing.current)
    let stop = false
    let timer = 0
    const canvas = document.createElement('canvas')
    void ocrService((p) => {
      if (!stop) setProgress(p)
    })

    const read = async () => {
      const v = videoRef.current
      if (stop || !v || !v.videoWidth || !v.clientWidth) return
      // What the band actually shows. object-cover scales the video to fill the
      // frame and throws away the overflow, so the picture on screen is a crop
      // of the stream — reading the stream's full width would take in print the
      // reader can't see and has no way to aim.
      const scale = Math.max(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight)
      const shownW = Math.min(v.videoWidth, v.clientWidth / scale)
      const shownH = Math.min(v.videoHeight, v.clientHeight / scale)
      const sw = Math.round(shownW)
      const sh = Math.round(shownH * BAND)
      const sx = Math.round((v.videoWidth - shownW) / 2)
      const sy = Math.round((v.videoHeight - sh) / 2)
      // At the stream's own scale: this is already just a band, and shrinking
      // it is exactly what costs accuracy.
      canvas.width = sw
      canvas.height = sh
      canvas.getContext('2d')?.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh)
      try {
        // The whole frame is parsed at once and the citations come back with
        // the references already worked out. Splitting the line up and parsing
        // the pieces again would lose every citation that names no book — 「5」
        // means chapter one's fifth verse beside 「啟一1～2」 and nothing at all
        // on its own — which is most of what a reading line is made of.
        const seen: { key: string; text: string }[] = []
        for (const c of citationsIn(await readCanvas(canvas))) {
          const key = c.refs
            .map((r) => `${r.bookNo}.${r.chapter}.${r.verseStart}.${r.verseEnd}.${r.note ?? ''}`)
            .join('|')
          if (!seen.some((f) => f.key === key)) seen.push({ key, text: c.text })
        }
        if (stop || seen.length === 0) return
        setFound((prev) =>
          prev.length === seen.length && prev.every((p, i) => p.key === seen[i].key) ? prev : seen,
        )
      } catch {
        /* one unreadable frame is not worth reporting */
      }
    }

    const loop = async () => {
      while (!stop) {
        await read()
        await new Promise((r) => {
          timer = window.setTimeout(r, EVERY_MS)
        })
      }
    }

    // Ask for as much resolution as the camera will give. Left to itself a
    // browser hands over something like 640x480, and at that size the print in
    // a band across the frame is too small to read — halving a page's pixels
    // was measured taking recognition from 94% to 13%. `ideal` degrades to
    // whatever the device actually has.
    asked.current ??= navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    })
    asked.current
      .then((s) => {
        if (stop) return
        if (videoRef.current) videoRef.current.srcObject = s
        void loop()
      })
      .catch(() => setError('沒辦法開啟相機'))

    return () => {
      stop = true
      clearTimeout(timer)
      // Handing the camera back is deferred by a tick and cancelled if the
      // effect runs again. A development remount tears this down and rebuilds
      // it immediately, and stopping the tracks in between would leave the
      // second run holding a dead stream; a real close has no second run.
      closing.current = window.setTimeout(() => {
        void asked.current?.then((s) => s.getTracks().forEach((t) => t.stop()))
        asked.current = null
      }, 0)
    }
  }, [])

  const all = found.map((f) => f.text).join('，')

  // Straight onto the body. On a phone this is opened from inside the drawer,
  // and vaul transforms that to drag it — which makes a fixed child position
  // itself against the drawer rather than the screen, so the viewfinder was
  // trapped in the sheet in portrait and only escaped in landscape, where the
  // layout is wide enough to drop the drawer for the sidebar.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {/* The band the reader aims with: everything outside it is dimmed, so
          * where to put the line needs no instructions beyond the one line. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          <div className="flex-1 bg-black/50" />
          <div style={{ height: `${BAND * 100}%` }} className="border-y-2 border-white/80" />
          <div className="flex-1 bg-black/50" />
        </div>
        <p className="pointer-events-none absolute inset-x-0 top-[calc(50%+var(--band))] mt-4 text-center text-sm text-white/90"
           style={{ ['--band' as string]: `${(BAND / 2) * 100}%` }}>
          {error ?? '把「讀經」那一行對進框裡'}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 rounded-full bg-black/50 p-2 text-white"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* A fixed height, not one that follows the contents. The list changes
        * with every frame, and a panel that grew and shrank with it would move
        * the band the reader is aiming with — under their hands, while they are
        * holding a page still. Two rows of citations fit; more scroll. */}
      {/* Padded clear of the bottom nav on a phone. The overlay covers it, but
        * a tap that dismisses the overlay is finished by hitting whatever now
        * sits at those coordinates — and 搜尋這 N 筆 sat exactly on 綱要, so
        * picking a citation landed on the outline page. --nav-h already carries
        * the safe-area inset. */}
      <div className="flex shrink-0 flex-col bg-card px-4 pt-3 pb-[calc(var(--nav-h)+0.5rem)] md:pb-3">
        <div className="h-24 overflow-y-auto">
          {progress.phase !== 'ready' ? (
            <div className="py-3 text-center">
              {progress.phase === 'downloading' && progress.total ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {`正在下載辨識模型　${(progress.done / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`}
                  </p>
                  <div className="mx-auto mt-2 h-1 max-w-xs overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                    />
                  </div>
                </>
              ) : (
                // No bar here. The runtime's own loading isn't ours to see, and
                // a bar that moves without measuring anything looks like one
                // that does.
                <p className="text-sm text-muted-foreground">正在啟動辨識…</p>
              )}
            </div>
          ) : found.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">還沒讀到引經</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* Nothing to dismiss: the list is whatever the camera is on, and
                * the next frame replaces it. Tapping one searches just it. */}
              {found.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onPick(f.text)}
                  className="rounded-lg bg-secondary px-3 py-1.5 font-serif text-sm text-secondary-foreground active:scale-95"
                >
                  {f.text}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Always here, so its arrival never shifts anything above it. */}
        <button
          type="button"
          disabled={found.length === 0}
          onClick={() => onPick(all)}
          className={cn(
            'mt-3 shrink-0 rounded-lg py-2.5 text-sm font-medium transition-colors',
            found.length
              ? 'bg-primary text-primary-foreground active:scale-[0.99]'
              : 'bg-secondary text-muted-foreground',
          )}
        >
          {found.length ? `搜尋這 ${found.length} 筆` : '搜尋'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
