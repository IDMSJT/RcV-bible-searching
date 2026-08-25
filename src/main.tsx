import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

// Cross-fade forward navigations, but not history back/forward — the phone's
// own swipe-back already animates, and a fade on top of it reads as a double
// move (you'd see the page you're leaving snapshot in, then dissolve to the one
// you went back to). TanStack applies the view transition on every commit with
// no way to branch on the history action, and it ignores the return value, so
// intercept at the source: popstate flags the transition it's about to cause,
// and for that one we run the DOM update directly WITHOUT starting a transition
// — nothing is captured, so there's no old snapshot to flash. Just skipping the
// animation isn't enough; the old snapshot is still grabbed and shown for a
// frame. The flag clears on use, with a timeout fallback for a pop that
// resolves to no transition.
if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
  let popPending = false
  window.addEventListener('popstate', () => {
    popPending = true
    setTimeout(() => {
      popPending = false
    }, 400)
  })
  const settled = Promise.resolve()
  const startViewTransition = document.startViewTransition.bind(document)
  document.startViewTransition = ((arg?: Parameters<Document['startViewTransition']>[0]) => {
    if (popPending) {
      popPending = false
      const update = typeof arg === 'function' ? arg : arg?.update
      void update?.()
      return {
        finished: settled,
        ready: settled,
        updateCallbackDone: settled,
        skipTransition: () => {},
        types: new Set<string>(),
      } as unknown as ViewTransition
    }
    return startViewTransition(arg)
  }) as Document['startViewTransition']
}

const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  defaultPreload: 'intent',
  // Cross-fade one route into the next (old fades out as new fades in) via the
  // View Transitions API. Where it isn't supported the navigation is just
  // instant. The chapter swipe opts out (ReadingPager.goTo) — the pager already
  // animates that move, and a fade on top would double it.
  defaultViewTransition: true,
  // Scroll restoration is ScrollBody's, not the router's. The router's version
  // assumes one stable scrolling element per route; the reading carousel mounts
  // three and remounts all of them on every navigation, and its habit of
  // carrying the previous location's offsets forward then lands one chapter on
  // the next. Its only opt-out, scrollToTopSelectors, also zeroes an element
  // after restoring it whenever the window entry is absent — which here is
  // always, since nothing in this app scrolls the window.
  scrollRestoration: false,
  // Plain string search params (no JSON quoting) — keeps URLs like ?hl=34
  parseSearch: (searchStr) => {
    const params = new URLSearchParams(searchStr)
    const out: Record<string, string> = {}
    for (const [k, v] of params) out[k] = v
    return out
  },
  stringifySearch: (search) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(search)) {
      if (v != null) params.append(k, String(v))
    }
    const str = params.toString()
    return str ? `?${str}` : ''
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
