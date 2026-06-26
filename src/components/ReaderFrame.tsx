import type { ReactNode } from 'react'
import { ScrollBody } from '@/components/ScrollBody'
import { useSwipeNav } from '@/lib/useSwipeNav'
import { cn } from '@/lib/utils'

/**
 * Shared chrome for the reading + outline pages: a full-height header with the
 * prev/next actions, a vertically-scrolling body, and the mobile swipe-to-page
 * gesture (with the edge peek labels). The two pages differ only in their title
 * and `children`; everything around the content is identical, so it lives here.
 */
export function ReaderFrame({
  title,
  leftAction,
  rightAction,
  onSwipePrev,
  onSwipeNext,
  prevLabel,
  nextLabel,
  swipeKey,
  swipeEnabled = true,
  children,
}: {
  title: ReactNode
  leftAction?: ReactNode
  rightAction?: ReactNode
  onSwipePrev?: () => void
  onSwipeNext?: () => void
  prevLabel?: string
  nextLabel?: string
  /** Re-centres the swipe offset when it changes (the page's id). */
  swipeKey: string
  /** Turn the gesture off (e.g. while selecting verses). */
  swipeEnabled?: boolean
  children: ReactNode
}) {
  const { dx, animating, armed, swipeProps } = useSwipeNav({
    onPrev: onSwipePrev,
    onNext: onSwipeNext,
    resetKey: swipeKey,
    enabled: swipeEnabled,
  })

  const dragStyle = {
    transform: dx ? `translateX(${dx}px)` : undefined,
    transition: animating ? 'transform 250ms ease-out' : undefined,
  }
  const chipCls = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap shadow-sm transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
    )

  return (
    <>
      <header className="border-b border-border bg-background">
        {/* 1fr_auto_1fr keeps the title dead-centre regardless of how wide the
         * left/right actions are (justify-between only centres when they match). */}
        <div className="mx-auto grid h-[var(--header-h)] max-w-3xl grid-cols-[1fr_auto_1fr] items-stretch">
          <div className="flex items-stretch">{leftAction}</div>
          <h1 className="self-center text-base font-medium tracking-tight">{title}</h1>
          <div className="flex items-stretch justify-end">{rightAction}</div>
        </div>
      </header>

      <ScrollBody>
        {/* The gesture layer is min-h-full so swiping works in the blank space
         * below short content too, not just over the text. overflow-x-clip
         * (static) contains the horizontal drag; the transform lives on the
         * inner layer; touch-pan-y keeps vertical scrolling native. */}
        <div {...swipeProps} className="min-h-full touch-pan-y overflow-x-clip">
          <div style={dragStyle}>{children}</div>
        </div>
      </ScrollBody>

      {/* Swipe peek — the target's label rides in from the screen edge as you
       * drag, turning primary once you're past the commit threshold. Viewport-
       * fixed + same dx so it stays centred regardless of scroll. Mobile only. */}
      {(prevLabel || nextLabel) && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-30 md:hidden" style={dragStyle}>
          {prevLabel && (
            <span className={cn(chipCls(armed === 'prev'), 'absolute top-1/2 right-full -translate-y-1/2')}>
              {prevLabel}
            </span>
          )}
          {nextLabel && (
            <span className={cn(chipCls(armed === 'next'), 'absolute top-1/2 left-full -translate-y-1/2')}>
              {nextLabel}
            </span>
          )}
        </div>
      )}
    </>
  )
}
