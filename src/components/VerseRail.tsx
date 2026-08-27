import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Vertical room each label gets on the rail. Big enough to stay legible and to
 * keep the drag from feeling twitchy. */
const RAIL_SLOT = 20

/**
 * The verse rail down the right edge — 經節軌 — in the manner of a phone contact
 * list's A–Z index: drag it to run through the chapter, release to land. Only
 * the labels are spaced out; the drag itself maps continuously over every
 * verse, so a chapter can be scrubbed as finely as it has verses.
 *
 * The number that follows a held finger is the 數字泡泡, below. Not a preview:
 * that word is taken here by the list of verses a citation opens.
 *
 * Its height follows the chapter's length rather than the screen's — a short
 * chapter gets a short rail — with the label spacing widening as needed to keep
 * the whole thing inside the reading area. */
export function VerseRail({
  verses,
  onScrub,
}: {
  verses: number[]
  /** Runs on press and on every move, so the page tracks the finger — then once
   * with null when the finger lifts, which is the page's cue to drop whatever
   * it was showing only for the duration of the drag. */
  onScrub: (verse: number | null) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [held, setHeld] = useState<number | null>(null)
  const [budget, setBudget] = useState(() => window.innerHeight * 0.62)

  useEffect(() => {
    const onResize = () => setBudget(window.innerHeight * 0.62)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const marks = useMemo(() => {
    const last = verses[verses.length - 1]
    for (const step of [5, 10, 20, 25, 50]) {
      const out = verses.filter((v, i) => i === 0 || v % step === 0 || v === last)
      if (out.length * RAIL_SLOT <= budget) return out
    }
    return [verses[0], last]
  }, [verses, budget])

  const pick = (clientY: number) => {
    const el = railRef.current
    if (!el) return
    const { top, height } = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientY - top) / height))
    const verse = verses[Math.round(frac * (verses.length - 1))]
    if (verse == null) return
    setHeld(verse)
    onScrub(verse)
  }

  const release = () => {
    setHeld(null)
    onScrub(null)
  }

  // Portalled to the body: on touch the reading surface sits inside the pager's
  // transformed carousel track, and a transform makes `fixed` resolve against
  // that ancestor instead of the viewport — the rail would land off-screen
  // beside the neighbouring panel. The copy bars are portalled for the same
  // reason.
  return createPortal(
    <>
      {/* 數字泡泡 — which verse the finger is on, while it is held. */}
      {held != null && (
        // The minimum has to clear two digits and their padding, or the bubble
        // still grows by a hair between 9 and 10: at text-lg two tabular digits
        // are about 22px and px-2 adds 16, so 2.5rem covers both and one digit
        // is padded out to match. Three keeps growing, which is right — the
        // psalms have verses past a hundred.
        <div className="pointer-events-none fixed top-1/2 left-1/2 z-50 flex min-w-10 -translate-x-1/2 -translate-y-1/2 justify-center rounded-lg bg-foreground px-2 py-1.5 font-sans text-lg font-medium text-background shadow-lg tabular-nums">
          {held}
        </div>
      )}
      <div
        ref={railRef}
        // Capture keeps the drag on the rail once it starts, so the pager's
        // horizontal swipe can't steal it mid-scrub.
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientY)
        }}
        onPointerUp={release}
        onPointerCancel={release}
        style={{ height: marks.length * RAIL_SLOT }}
        className="fixed top-1/2 right-0 z-30 flex w-8 -translate-y-1/2 touch-none flex-col items-end justify-between pr-1 font-sans text-[0.6875rem] leading-none font-medium text-muted-foreground/70 tabular-nums select-none"
      >
        {marks.map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
    </>,
    document.body,
  )
}
