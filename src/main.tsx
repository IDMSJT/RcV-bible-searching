import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  defaultPreload: 'intent',
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
