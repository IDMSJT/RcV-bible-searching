// Google Analytics 4: how many people use the app, which features, what they
// search for. Only the published site reports — not `pnpm dev`, not a preview
// build, not a copy served from anywhere else — so testing never shows up in
// the numbers.
//
// Page views are sent by hand on route changes (see __root): the stream's
// "page changes based on browser history events" is switched off, because the
// drawer (?panel=) also changes the URL and isn't a page.

const GA_ID = 'G-GCP8PFZF98'
const SITE_HOST = 'idmsjt.github.io'

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

const enabled =
  import.meta.env.PROD && typeof window !== 'undefined' && window.location.hostname === SITE_HOST

let started = false

/** Load gtag.js once. Safe to call more than once. */
export function initAnalytics(): void {
  if (!enabled || started) return
  started = true
  window.dataLayer = window.dataLayer || []
  // gtag queues its arguments object as-is; that's the documented form.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, { send_page_view: false })
  // Installed to the home screen or opened in a tab — kept on every event.
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  window.gtag('set', 'user_properties', { app_mode: standalone ? 'installed' : 'browser' })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)
}

/** One event, with whatever parameters describe it. Never throws. */
export function track(event: string, params: Record<string, string | number | boolean | undefined> = {}): void {
  if (!enabled) return
  try {
    window.gtag?.('event', event, params)
  } catch {
    /* analytics must never break the app */
  }
}

/** A page view, for the router's path and a readable title (「加拉太書 4」). */
export function trackPage(path: string, title: string): void {
  if (!enabled) return
  // Built from the route, not window.location: the router can still be flushing
  // the URL when this runs, and the drawer's ?panel= isn't part of the page.
  const location = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + path
  track('page_view', { page_path: path, page_location: location, page_title: title })
}
