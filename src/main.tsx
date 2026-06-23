import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  defaultPreload: 'intent',
  scrollRestoration: true,
  // the chapter content scrolls inside <main>, not window
  scrollToTopSelectors: ['[data-scroll-restoration-id="main"]'],
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
