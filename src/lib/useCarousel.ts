import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Past this finger speed (px/ms) a release commits even if it never reached
 * the distance threshold — a quick flick pages like a snap. */
const FLICK = 0.4

/**
 * Horizontal paging for the reading carousel. The track holds [prev, current,
 * next] panels at translateX(-100% + dx); dragging adjusts dx, release snaps. A
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
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  resetKey,
  enabled = true,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  /** The current ref's identity — changes when a page lands. */
  resetKey: unknown
  /** Off while selecting verses, so a swipe doesn't page away. */
  enabled?: boolean
}) {
  const [dx, setDx] = useState(0)
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

  const set = (v: number) => {
    dxRef.current = v
    setDx(v)
  }

  useLayoutEffect(() => {
    committing.current = false
    setTargetDir(null)
    setAnimating(false)
    set(0)
  }, [resetKey])

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

  const EDGE = 24
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType === 'mouse' || committing.current) return
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
    set(v)

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
      set(dir === 'prev' ? w : -w)
      window.setTimeout(dir === 'prev' ? onPrev : onNext, 260)
    } else {
      setTargetDir(null)
      set(0) // snap back
    }
  }

  return {
    dx,
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
