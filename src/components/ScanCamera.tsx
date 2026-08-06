import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { citationsIn } from '@/lib/scannedText'
import { prepareOcr, readBand, type Progress } from '@/lib/scanPhoto'
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

/** The results panel's height. The band is centred in what is left of the
 * camera above it, not in the screen — half the reason to hold a phone still is
 * knowing where the middle is, and the middle of the picture the reader can
 * actually use is higher than the middle of the glass. */
const PANEL = 176

/** Where the band's centre sits, as a share of the screen's height. */
const centre = (screenH: number) => 0.5 - PANEL / (2 * screenH)

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
  // A phone's back camera is several lenses, and opening one at a high
  // resolution starts a default mode and then reconfigures — which reads as the
  // picture jumping once before it settles. The switch can't be prevented from
  // here, but it needn't be watched: the stream is revealed once its reported
  // size has held still for a moment.
  const [settled, setSettled] = useState(false)
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
    void prepareOcr((p) => {
      if (!stop) setProgress(p)
    })

    const read = async () => {
      const v = videoRef.current
      if (stop || !v || !v.videoWidth || !v.clientHeight) return
      // What the band shows. Filling the screen means cropping the stream to
      // its shape, so the picture is a slice of what the camera has; reading
      // past that would take in print nobody can see or aim at. Every pixel of
      // the screen is picture, so a band that is a share of the screen is the
      // same share of the slice — and it follows the band up past the panel, or
      // the frame would be in one place and the reading from another.
      const scale = Math.max(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight)
      const shownW = Math.min(v.videoWidth, v.clientWidth / scale)
      const shownH = Math.min(v.videoHeight, v.clientHeight / scale)
      const rect = {
        x: Math.round((v.videoWidth - shownW) / 2),
        y: Math.round((v.videoHeight - shownH) / 2 + (centre(v.clientHeight) - BAND / 2) * shownH),
        width: Math.round(shownW),
        height: Math.round(shownH * BAND),
      }
      try {
        // At the stream's own scale — shrinking it is what costs accuracy.
        const seen: { key: string; text: string }[] = []
        for (const c of citationsIn(await readBand(v, rect))) {
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

    // As much resolution as the camera will give. Left to itself a browser
    // hands over something like 640x480, and at that size the print in a band
    // across the frame is too small to read — halving a page's pixels was
    // measured taking recognition from 94% to 13%. `ideal` degrades to whatever
    // the device actually has.
    // Which lens is left to the phone. Its rear camera is usually a virtual
    // device standing for two or three of them and it changes between them as
    // the subject gets nearer — the jump when a page moves in and out. Naming
    // one lens stops that, but the one that focuses closest is exactly the one
    // it switches to, so the cure would be a page that won't focus.
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
        const v = videoRef.current
        if (!v) return
        v.srcObject = s
        // Every reconfiguration changes the frame size, so each one pushes the
        // reveal back; when they stop, what is left is a steady picture.
        let hold = 0
        const wait = () => {
          clearTimeout(hold)
          hold = window.setTimeout(() => {
            if (!stop) setSettled(true)
          }, 400)
        }
        v.addEventListener('resize', wait)
        v.addEventListener('loadeddata', wait)
        wait()
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
    // pointer-events-auto is not decoration. vaul's drawer is a modal, so while
    // it is open the body is pointer-events:none and only the drawer's own
    // content sets itself back — and that property inherits. Portalled to the
    // body, every button in here was dead, and taps went to whatever had put
    // itself back: the drawer underneath, and the bottom nav, which is why
    // picking a citation opened 綱要. The nav does the same thing for the same
    // reason.
    <div data-scanner className="pointer-events-auto fixed inset-0 z-[80] bg-black">
      {/* The camera fills the screen; everything else floats over it. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
          settled ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* The band the reader aims with: everything outside it is dimmed, so
        * where to put the line needs no instructions beyond the one line. Held
        * as a share of the screen, which is all picture — the same share of
        * what the camera sees, whichever way the phone is turned. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={
          {
            // Top of the band: the middle of the camera left showing, less half
            // the band. In CSS so it follows the screen without measuring.
            '--band-top': `calc(50% - ${PANEL / 2}px - ${BAND * 50}%)`,
            '--band-h': `${BAND * 100}%`,
          } as CSSProperties
        }
      >
        <div className="absolute inset-x-0 top-0 h-[var(--band-top)] bg-black/45" />
        <div className="absolute inset-x-0 top-[var(--band-top)] h-[var(--band-h)] border-y-2 border-white/80" />
        <div className="absolute inset-x-0 top-[calc(var(--band-top)+var(--band-h))] bottom-0 bg-black/45" />
        <p className="absolute inset-x-0 top-[calc(var(--band-top)+var(--band-h))] mt-4 text-center text-sm text-white/90">
          {error ?? (settled ? '把「讀經」那一行對進框裡' : '相機啟動中…')}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉"
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 rounded-full bg-black/50 p-2 text-white"
      >
        <X className="size-5" />
      </button>

      <div
        style={{ height: PANEL }}
        className="absolute inset-x-0 bottom-0 flex flex-col bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <div className="min-h-0 flex-1 overflow-y-auto">
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
        {/* Always here, so its arrival never shifts anything above it. With
          * nothing read it is the way out instead of a dead grey button — the
          * ✕ is up in a corner, and this is where a thumb already is. */}
        <button
          type="button"
          onClick={found.length ? () => onPick(all) : onClose}
          className={cn(
            'mt-3 shrink-0 rounded-lg py-2.5 text-sm font-medium transition-colors active:scale-[0.99]',
            found.length
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground',
          )}
        >
          {found.length ? `搜尋這 ${found.length} 筆` : '返回'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
