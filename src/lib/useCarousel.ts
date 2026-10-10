import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Past this finger speed (px/ms) a release commits even if it never reached
 * the distance threshold — a quick flick pages like a snap. */
const FLICK = 0.4

/** Duration of the commit/snap-back slide. Callers use this for their own
 * `transition` style (it has to match — the hook only drives transform) and
 * the hook times the actual page-change off it below, so there's one number
 * to tune the whole feel. */
export const COMMIT_MS = 200

/**
 * Horizontal paging for the reading carousel. Dragging writes the track's
 * transform (via `getTransform`) straight to `trackRef`'s DOM node — no React
 * state in the loop, so a drag never re-renders the panels it's sliding. A
 * release commits when the drag passed ~25% of the width OR was a fast flick.
 * `targetDir` arms as soon as the drag crosses the threshold (so the caller can
 * flip the title before the finger lifts) and is kept through the commit slide;
 * it clears on snap-back and when the new page lands.
 *
 * Touch/pen only; bails on vertical drags (and suppresses the browser's pan so
 * a locked-horizontal swipe can't be stolen mid-drag); rubber-bands at the ends.
 */
export function useCarousel({
  containerRef,
  trackRef,
  getTransform,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onCommit,
  resetKey,
  enabled = true,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  /** The sliding track itself — the element `getTransform`'s string is
   * applied to. Written straight to `el.style.transform` on every pointer
   * move, bypassing React state: a drag used to call `setState` per pixel,
   * which re-rendered the whole panel tree (all three chapters' worth of
   * text, notes and cross-refs) 60 times a second just to move one transform.
   * Nothing about a drag needs React to know about it frame by frame — only
   * the rare, discrete moments (threshold crossed, released, landed) do, and
   * those still go through state below. */
  trackRef: React.RefObject<HTMLElement | null>
  /** Builds the track's transform from the current drag offset — callers
   * differ in what the offset sits on top of (a fixed -100% for a 3-slot
   * reading track, -activeIndex*100% for a 2-tab one). */
  getTransform: (dx: number) => string
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  /** Fires synchronously the moment a release commits — still inside the
   * pointerup handler, unlike onPrev/onNext which run after the slide. iOS only
   * opens the soft keyboard from a focus() made during the user gesture, so a
   * caller that wants to focus the incoming panel must do it here, not in
   * onPrev/onNext. */
  onCommit?: (dir: 'prev' | 'next') => void
  /** The current ref's identity — changes when a page lands. */
  resetKey: unknown
  /** Off while selecting verses, so a swipe doesn't page away. */
  enabled?: boolean
}) {
  const [animating, setAnimating] = useState(false)
  // The direction the swipe is heading: armed while dragging past the threshold,
  // kept through the commit slide, cleared on snap-back / land.
  const [targetDir, setTargetDir] = useState<'prev' | 'next' | null>(null)
  const dxRef = useRef(0)
  const drag = useRef<{
    x: number
    y: number
    axis: 'none' | 'h'
    w: number
    lastX: number
    lastT: number
    vx: number
  } | null>(null)
  const committing = useRef(false)

  // Latest getTransform, read from event handlers rather than closed over —
  // those handlers are only (re)subscribed via the JSX spread below, so a
  // stale closure would apply a stale base offset (e.g. the search tabs'
  // -activeIndex*100%) until the next drag.
  const getTransformRef = useRef(getTransform)

  const applyTransform = useCallback(
    (v: number) => {
      dxRef.current = v
      const el = trackRef.current
      if (el) el.style.transform = getTransformRef.current(v)
    },
    [trackRef],
  )

  // Re-applies on every render, not just when getTransform's identity
  // changes (it's a fresh arrow function each render anyway) — cheap (one
  // style write) and keeps the track correct the instant a non-drag cause
  // (e.g. tapping a tab directly) changes what getTransform would return for
  // the same dx.
  useLayoutEffect(() => {
    getTransformRef.current = getTransform
    applyTransform(dxRef.current)
  })

  useLayoutEffect(() => {
    committing.current = false
    setTargetDir(null)
    setAnimating(false)
    // Land at dx 0 with the transition killed *synchronously* — not via the
    // animating state round-trip, which only reaches the DOM on React's next
    // commit. The commit slide a moment ago left transition: '…Nms ease-out'
    // sitting in the DOM; a plain applyTransform(0) here would change the
    // transform while that's still in effect and the browser would animate
    // the snap, undoing the slide that just finished landing the new page.
    const el = trackRef.current
    if (el) el.style.transition = 'none'
    applyTransform(0)
  }, [resetKey, applyTransform, trackRef])

  // Once the gesture is locked horizontal, swallow the browser's vertical pan so
  // it can't steal (and cancel) the swipe mid-drag.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (drag.current?.axis === 'h') e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [containerRef])

  /**
   * Is there a live text selection inside the track?
   *
   * Read from the DOM at gesture time rather than trusted to `enabled`, which
   * arrives too late twice over: a long-press fires pointerdown BEFORE it
   * produces a selection (so the drag is already armed by the time the caller
   * knows), and the caller's answer has to travel back through React state
   * anyway. A finger moving over a live selection is dragging its handles, not
   * paging.
   */
  const selectionInTrack = () => {
    const el = containerRef.current
    const sel = document.getSelection()
    if (!el || !sel || sel.isCollapsed || sel.toString().trim().length === 0) return false
    return sel.anchorNode != null && el.contains(sel.anchorNode)
  }

  const EDGE = 24
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType === 'mouse' || committing.current) return
    if (selectionInTrack()) return
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      axis: 'none',
      w: containerRef.current?.clientWidth ?? window.innerWidth,
      lastX: e.clientX,
      lastT: e.timeStamp,
      vx: 0,
    }
    setAnimating(false)
    setTargetDir(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    // The long-press case: the finger was already down (and the drag armed)
    // when the selection appeared under it. Hand the gesture back the moment
    // that happens, springing the track home if it had begun to move.
    if (selectionInTrack()) {
      drag.current = null
      if (dxRef.current !== 0) {
        setAnimating(true)
        setTargetDir(null)
        applyTransform(0)
      }
      return
    }
    const ddx = e.clientX - d.x
    const ddy = e.clientY - d.y
    if (d.axis === 'none') {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return
      if (Math.abs(ddx) <= Math.abs(ddy) * 1.2) {
        drag.current = null
        return
      }
      d.axis = 'h'
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    const dt = e.timeStamp - d.lastT
    if (dt > 0) d.vx = (e.clientX - d.lastX) / dt
    d.lastX = e.clientX
    d.lastT = e.timeStamp

    const w = d.w
    let v = ddx
    if ((ddx > 0 && !hasPrev) || (ddx < 0 && !hasNext)) v = ddx * 0.2
    else if (v > w) v = w + (v - w) * 0.2
    else if (v < -w) v = -w + (v + w) * 0.2
    applyTransform(v)

    // Arm the title direction once the drag passes the commit distance.
    const t = Math.min(w * 0.25, 100)
    setTargetDir(v >= t && hasPrev ? 'prev' : v <= -t && hasNext ? 'next' : null)
  }

  // Release commits past the threshold OR on a fast flick. Cancel (e.g. iOS
  // stealing the gesture) never commits — it just springs back, so the drag
  // stays under the user's control until they lift.
  const finish = (commit: boolean) => {
    const d = drag.current
    drag.current = null
    if (!d || d.axis !== 'h') return
    const w = d.w
    const threshold = Math.min(w * 0.25, 100)
    const moved = dxRef.current
    let dir: 'prev' | 'next' | null = null
    if (d.vx >= FLICK && hasPrev) dir = 'prev'
    else if (d.vx <= -FLICK && hasNext) dir = 'next'
    else if (moved >= threshold && hasPrev) dir = 'prev'
    else if (moved <= -threshold && hasNext) dir = 'next'

    setAnimating(true)
    if (commit && dir) {
      committing.current = true
      setTargetDir(dir)
      applyTransform(dir === 'prev' ? w : -w)
      onCommit?.(dir) // synchronous — inside the gesture, so focus() can open the keyboard
      window.setTimeout(dir === 'prev' ? onPrev : onNext, COMMIT_MS + 10)
    } else {
      setTargetDir(null)
      applyTransform(0) // snap back
    }
  }

  return {
    animating,
    targetDir,
    // Capture, not bubble: a note card, a verse preview and every citation
    // inside them stop pointerdown from propagating, each for its own good
    // reason — to keep the surrounding verse's long-press or the card's own
    // select from firing. Paging the chapter is the container's gesture, not
    // theirs to cancel, and it was going unheard anywhere inside a card.
    // Capturing doesn't consume the event, so those handlers still run.
    trackProps: {
      onPointerDownCapture: onPointerDown,
      onPointerMoveCapture: onPointerMove,
      onPointerUpCapture: () => finish(true),
      onPointerCancelCapture: () => finish(false),
    },
  }
}
