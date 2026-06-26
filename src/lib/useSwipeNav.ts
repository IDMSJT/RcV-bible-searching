import { useLayoutEffect, useRef, useState } from 'react'

/** Released drag offset handed to the *next* page so it can ease home. Module-
 * level on purpose: chapter↔outline crosses routes, so the frame unmounts and
 * a component ref wouldn't survive — this does. Only one reader frame is
 * mounted at a time, so there's no contention. */
let incoming: number | null = null

/** Displayed drag offset for a raw finger delta: 1:1 up to `SOFT`px, then eased
 * with diminishing returns toward a cap, so the content can't be dragged
 * arbitrarily far. Directions with no target (`blocked`) get a much stiffer,
 * lower cap so the edges feel like a wall. */
function resist(raw: number, blocked: boolean): number {
  const s = Math.sign(raw)
  const a = Math.abs(raw)
  if (blocked) return s * Math.min(a * 0.2, 28)
  const W = typeof window !== 'undefined' ? window.innerWidth : 360
  const SOFT = 40
  const max = Math.min(W * 0.26, 104)
  if (a <= SOFT) return raw
  const span = max - SOFT
  return s * (SOFT + span * (1 - 1 / (1 + (a - SOFT) / span)))
}

/**
 * Horizontal swipe-to-navigate for the reading view (mobile). Drag the content
 * left to go to `onNext`, right for `onPrev`; release past the threshold to
 * navigate, otherwise it springs back to centre. A committed swipe hands its
 * released offset to the next page, which mounts holding it and eases home — a
 * small spring that works the same whether or not the route changed.
 *
 * The bound element must carry `touch-action: pan-y` so the browser still owns
 * vertical scrolling while horizontal drags come through as pointer events. We
 * only act on touch/pen (desktop mouse is left alone), ignore drags starting in
 * the ~24px screen-edge zone (so iOS back/forward keeps working), and bail the
 * moment a gesture reads as vertical.
 */
export function useSwipeNav({
  onPrev,
  onNext,
  resetKey,
  enabled = true,
}: {
  onPrev?: () => void
  onNext?: () => void
  /** Changes whenever the page changes (e.g. the chapter / outline id). */
  resetKey: unknown
  enabled?: boolean
}) {
  const [dx, setDx] = useState(0)
  const [animating, setAnimating] = useState(false)
  // Which direction is currently past the commit threshold (so releasing now
  // would navigate), or null. Lets the caller flag "will go" on the peek label.
  const [armed, setArmed] = useState<'prev' | 'next' | null>(null)
  const dxRef = useRef(0)
  const rawRef = useRef(0)
  const drag = useRef<{ x: number; y: number; axis: 'none' | 'h' } | null>(null)

  const set = (v: number) => {
    dxRef.current = v
    setDx(v)
  }

  const threshold = () => Math.min(window.innerWidth * 0.25, 100)

  // Runs on mount and on every page change. If a swipe was just committed, the
  // released offset is waiting in `incoming`: drop the new page there (before
  // paint, so no centred flash) then ease it home. Otherwise re-centre instantly
  // (e.g. an arrow tap). Nulling `incoming` inside the rAF keeps it intact across
  // StrictMode's double-invoked mount effects.
  useLayoutEffect(() => {
    if (incoming !== null) {
      const from = incoming
      setAnimating(false)
      set(from)
      requestAnimationFrame(() => {
        incoming = null
        setAnimating(true)
        set(0)
      })
    } else {
      set(0)
      setAnimating(false)
    }
    setArmed(null)
  }, [resetKey])

  const EDGE = 24
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType === 'mouse') return
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return
    drag.current = { x: e.clientX, y: e.clientY, axis: 'none' }
    rawRef.current = 0
    setAnimating(false)
    setArmed(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const ddx = e.clientX - d.x
    const ddy = e.clientY - d.y
    if (d.axis === 'none') {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return
      // Bias toward vertical so scrolling wins ties; abandon if it's a scroll.
      if (Math.abs(ddx) <= Math.abs(ddy) * 1.2) {
        drag.current = null
        return
      }
      d.axis = 'h'
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    rawRef.current = ddx
    const blocked = (ddx > 0 && !onPrev) || (ddx < 0 && !onNext)
    set(resist(ddx, blocked))
    const t = threshold()
    setArmed(ddx >= t && onPrev ? 'prev' : ddx <= -t && onNext ? 'next' : null)
  }

  const end = () => {
    const d = drag.current
    drag.current = null
    if (!d || d.axis !== 'h') return
    // Threshold is on raw finger travel, not the eased offset.
    const raw = rawRef.current
    const t = threshold()
    setArmed(null)
    if (raw >= t && onPrev) {
      incoming = dxRef.current // next page eases home from here
      onPrev()
    } else if (raw <= -t && onNext) {
      incoming = dxRef.current
      onNext()
    } else {
      // Spring back, no navigation. rAF so the transition is live before the
      // value change (otherwise it can snap instead of ease).
      setAnimating(true)
      requestAnimationFrame(() => set(0))
    }
  }

  return {
    dx,
    animating,
    armed,
    swipeProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  }
}
