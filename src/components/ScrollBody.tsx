import {
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type RefObject,
} from 'react'
import { useLocation } from '@tanstack/react-router'
import { scrollKey } from '@/lib/scrollMemory'
import { cn } from '@/lib/utils'

/**
 * A scrolling region that remembers where it was left.
 *
 * It lives inside the non-scrolling <main> so that sibling page headers (the
 * chapter / outline titles) stay put instead of scrolling away.
 *
 * Every page that scrolls used to carry its own copy of the remembering —
 * read the saved offset, re-apply it for a few frames, write it back on
 * scroll — and the copies had drifted apart. Here it is once, so a new page
 * gets it by existing rather than by remembering to ask for it.
 *
 * The position is filed under the pathname, which is enough because only one of
 * these is ever live: the reading carousel mounts three at a time, but the two
 * it isn't showing are paused, and the one it is showing is the one the URL
 * names. `restoreKey` is there for a page that ever breaks that.
 *
 * The search string is deliberately not part of the key. A verse-focused view
 * (`?hl=29`) is a visit to the same page, not a different page; it pauses
 * rather than filing a position of its own, so returning to the plain URL lands
 * where the reader actually was.
 */
export function ScrollBody({
  children,
  className,
  paused,
  restoreKey,
  ref,
  ...rest
}: ComponentPropsWithoutRef<'div'> & {
  /** Skip both halves — don't restore, don't record. For a view that exists to
   * put the reader somewhere specific (`?hl=`, `?oh=`, `?oe=`), and for the
   * carousel panels either side of the one being read. */
  paused?: boolean
  /** Overrides the pathname, for a page with more than one live region. */
  restoreKey?: string
  ref?: RefObject<HTMLDivElement | null>
}) {
  const { pathname } = useLocation()
  const own = useRef<HTMLDivElement | null>(null)
  const el = ref ?? own
  const id = restoreKey ?? pathname

  useLayoutEffect(() => {
    const node = el.current
    if (!node || paused) return
    const key = scrollKey(id)
    const saved = sessionStorage.getItem(key)
    const target = saved !== null ? Number(saved) : 0
    const apply = () => {
      node.scrollTop = target
    }
    // Set before paint, then again over the next couple of frames: iOS
    // WKWebView (a standalone PWA) restores a freshly mounted scroll container
    // to its old position *after* this effect, so a single set gets undone —
    // which is why the symptom only ever appeared in the installed app.
    apply()
    const frames = [requestAnimationFrame(apply)]
    frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(apply))))

    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => sessionStorage.setItem(key, String(node.scrollTop)))
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      frames.forEach(cancelAnimationFrame)
      cancelAnimationFrame(raf)
      node.removeEventListener('scroll', onScroll)
    }
  }, [el, id, paused])

  return (
    <div
      ref={el}
      className={cn('overflow-y-auto pb-[var(--nav-h)] md:pb-0', className)}
      {...rest}
    >
      {children}
    </div>
  )
}
