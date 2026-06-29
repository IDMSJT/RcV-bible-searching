import { useEffect, useState } from 'react'

/** True when the device's primary pointer is touch (`pointer: coarse`) — phones
 * AND tablets, regardless of viewport width. Used to gate touch gestures (e.g.
 * the swipe-to-change-chapter carousel) independently of the width-based layout,
 * so a wide tablet keeps the desktop layout but still gets swipe. A touch laptop
 * with a mouse reports `fine`, so it won't trigger touch-only gestures. */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setIsTouch(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isTouch
}
