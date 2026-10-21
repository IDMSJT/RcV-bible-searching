import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { ChartHeader } from '@/components/ChartHeader'
import { CHARTS, chartSrc, type Chart } from '@/data/charts'
import { toChineseNumber } from '@/lib/chinese'
import { cn } from '@/lib/utils'

const MAX_SCALE = 5
const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(1, s))

const route = getRouteApi('/charts/$n')

export function ChartPage() {
  const { n } = route.useParams()
  return <ChartViewer key={n} n={n} />
}

function ChartViewer({ n }: { n?: string }) {
  const chart = CHARTS.find((c) => String(c.n) === n)
  if (!chart) return null
  return <ChartBody chart={chart} />
}

function ChartBody({ chart }: { chart: Chart }) {
  const router = useRouter()
  const navigate = useNavigate()
  // Back to wherever it was opened from — the catalog, or the note that cited it.
  // Opened cold (a shared link) there is nothing behind it, so go home.
  const goBack = () => {
    if (window.history.length > 1) router.history.back()
    else navigate({ to: '/' })
  }
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const scaleRef = useRef(scale)
  // Where the image's top-left should sit on screen (viewport coordinates)
  // once the new scale has laid out. Zooming works by saying where the image
  // ends up, then scrolling to make the layout agree — not by working out a
  // scroll offset from fractions, which drifts whenever the image is smaller
  // than the box on one axis.
  const target = useRef<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const settle = useCallback(() => {
    const el = boxRef.current
    const img = imgRef.current
    const t = target.current
    if (!el || !img) return
    img.style.transform = ''
    if (!t) return
    const r = img.getBoundingClientRect()
    el.scrollLeft += r.left - t.left
    el.scrollTop += r.top - t.top
    target.current = null
  }, [])

  useLayoutEffect(() => {
    scaleRef.current = scale
    settle()
  }, [scale, settle])

  const place = useCallback(
    (next: number, left: number, top: number) => {
      target.current = { left, top }
      if (next === scaleRef.current) settle()
      else setScale(next)
    },
    [settle],
  )

  // Make `next` the scale with the point at (cx, cy) on screen, and what is
  // under it, staying put.
  const commit = useCallback(
    (next: number, cx: number, cy: number) => {
      const img = imgRef.current
      if (!img) return
      const r = img.getBoundingClientRect()
      const k = next / scaleRef.current
      place(next, cx - (cx - r.left) * k, cy - (cy - r.top) * k)
    },
    [place],
  )

  // Two-finger pinch and double-tap. The pinch is drawn as a transform on the
  // image (fast, and exact about the fingers) and only turned into a real size
  // and scroll position when the fingers lift. Non-passive so the page itself
  // doesn't also zoom; one-finger drags are left to the browser's scrolling.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    let pinch: {
      d0: number
      s0: number
      cx: number
      cy: number
      left0: number
      top0: number
      w0: number
      h0: number
      box: DOMRect
      k: number
      left: number
      top: number
    } | null = null
    let lastTap = 0
    let moved = false
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    })
    const onStart = (e: TouchEvent) => {
      moved = false
      const img = imgRef.current
      if (e.touches.length === 2 && img) {
        const r = img.getBoundingClientRect()
        const c = mid(e.touches)
        pinch = {
          d0: dist(e.touches),
          s0: scaleRef.current,
          cx: c.x,
          cy: c.y,
          left0: r.left,
          top0: r.top,
          w0: r.width,
          h0: r.height,
          box: el.getBoundingClientRect(),
          k: 1,
          left: r.left,
          top: r.top,
        }
        img.style.transformOrigin = '0 0'
      }
    }
    const onMove = (e: TouchEvent) => {
      moved = true
      const img = imgRef.current
      if (!pinch || !img || e.touches.length !== 2) return
      e.preventDefault()
      const c = mid(e.touches)
      const k = clamp((pinch.s0 * dist(e.touches)) / pinch.d0) / pinch.s0
      // Held inside where the scroll box could put it, so the image can't be
      // dragged off the edge mid-pinch only to snap back when the fingers lift.
      const hold = (want: number, size: number, lo: number, hi: number) =>
        size <= hi - lo ? lo + (hi - lo - size) / 2 : Math.min(lo, Math.max(hi - size, want))
      const left = hold(
        c.x - (pinch.cx - pinch.left0) * k,
        pinch.w0 * k,
        pinch.box.left,
        pinch.box.right,
      )
      const top = hold(
        c.y - (pinch.cy - pinch.top0) * k,
        pinch.h0 * k,
        pinch.box.top,
        pinch.box.bottom,
      )
      pinch.k = k
      pinch.left = left
      pinch.top = top
      img.style.transform = `translate(${left - pinch.left0}px, ${top - pinch.top0}px) scale(${k})`
    }
    const onEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        const p = pinch
        pinch = null
        const img = imgRef.current
        if (img) {
          // The rect is the untransformed layout again once the transform goes.
          img.style.transform = ''
          place(clamp(p.s0 * p.k), p.left, p.top)
        }
        return
      }
      if (moved || e.touches.length > 0 || e.changedTouches.length !== 1) return
      const now = performance.now()
      if (now - lastTap < 300) {
        const t = e.changedTouches[0]
        commit(scaleRef.current > 1.01 ? 1 : 2.5, t.clientX, t.clientY)
        lastTap = 0
      } else lastTap = now
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [commit, place])

  // Short side to the screen: a wide chart takes the screen's height, a tall
  // one its width, and the long side runs off to be scrolled.
  const fit =
    box.w && box.h
      ? chart.contain
        ? Math.min(box.w / chart.w, box.h / chart.h)
        : chart.w >= chart.h
          ? box.h / chart.h
          : box.w / chart.w
      : 0
  
  return (
    <>
      <ChartHeader title={`圖${toChineseNumber(chart.n)} ${chart.name}`} onBack={goBack} />
      <div className="flex min-h-0 flex-1 flex-col bg-background pb-[calc(var(--nav-h)-1px)] md:pb-0">
      <div ref={boxRef} className="flex min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto">
        {fit > 0 && (
          <img
            ref={(el) => {
              imgRef.current = el
              // Already in the cache by the time it mounts: nothing to fade.
              if (el?.complete && el.naturalWidth > 0) setLoaded(true)
            }}
            onLoad={() => setLoaded(true)}
            key={chart.n}
            src={chartSrc(chart.n)}
            alt={`圖${toChineseNumber(chart.n)} ${chart.name}`}
            width={chart.w * fit * scale}
            height={chart.h * fit * scale}
            draggable={false}
            className={cn(
              // Multiply lets the chart's white paper take on the page colour
              // (light only — on dark it would swallow the black linework).
              'm-auto block max-w-none shrink-0 select-none mix-blend-multiply transition-opacity duration-500 dark:mix-blend-normal',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}
      </div>
      </div>
    </>
  )
}
