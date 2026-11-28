// Google Analytics 4 — everything the app reports lives here: how many people
// use it, which features, what they search for. Components call the named
// functions below with plain data; event names and parameter names are decided
// in this file only, so the reports stay consistent and there is one place to
// see what is collected.
//
// Only the published site reports — not `pnpm dev`, not a preview build, not a
// copy served from anywhere else — so testing never shows up in the numbers.
//
// Page views: GA sends the landing page's itself; every later route change is
// sent by hand (trackPage, from __root). The stream's automatic page views on
// history changes are switched off, because the drawer (?panel=) also changes
// the URL and isn't a page.

import { BOOK_ABBREV } from '@/data/abbrev'
import { pageTitle } from '@/lib/pageTitle'

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

type Params = Record<string, string | number | boolean | undefined>

/** One event. Never throws: analytics must never break the app. */
function track(event: string, params: Params = {}): void {
  if (!enabled) return
  try {
    window.gtag?.('event', event, params)
  } catch {
    /* ignore */
  }
}

/** 「加4:2」, 「加4:2註1」 — how a place in the Bible reads in the reports. */
function refLabel(bookNo: number, chapter: number, verse: number, note?: number): string {
  return `${BOOK_ABBREV[bookNo] ?? bookNo}${chapter}:${verse}${note ? `註${note}` : ''}`
}

// ---------- pages ----------

let landed = false

/** A page view for the router's path (no ?panel=: the drawer isn't a page).
 *
 * Not for the page the app opens on: GA sends that one itself when its script
 * loads — `send_page_view: false` doesn't stop it — so sending ours as well
 * would count every visit's first page twice. (Its title is the tab's, which
 * __root keeps in step with the route.) Later routes are ours alone: the
 * stream's automatic page views on history changes are switched off. */
export function trackPage(pathname: string): void {
  if (!enabled) return
  if (!landed) {
    landed = true
    return
  }
  // Built from the route, not window.location: the router can still be flushing
  // the URL when this runs.
  const location = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + pathname
  track('page_view', { page_path: pathname, page_location: location, page_title: pageTitle(pathname) })
}

// ---------- search ----------

/** A keyword search the reader waited for. `suggestion` is the word a sound
 * match found when the typed one wasn't in the text (別士巴 → 別是巴). */
export function trackSearch(s: {
  term: string
  scope: string
  results: number
  bySound: boolean
  suggestion?: string
}): void {
  track('search', {
    search_term: s.term,
    scope: s.scope,
    results: s.results,
    by_sound: s.bySound,
    suggestion: s.suggestion,
  })
}

/** What was typed in the 經節 field, and how many references it made. */
export function trackVerseLookup(query: string, refs: number): void {
  track('verse_lookup', { query, refs })
}

/** The reader took a 「你是不是想搜尋」 suggestion. */
export function trackSoundSuggestion(typed: string, picked: string): void {
  track('sound_suggestion', { typed, picked })
}

// ---------- 名詞解釋 ----------

/** Which word's card a search brought up. */
export function trackGlossaryView(term: string): void {
  track('glossary_view', { term })
}

/** The reader followed a card to its footnote (note 0: the verse itself). */
export function trackGlossaryOpen(term: string, [bookNo, chapter, verse, note]: [number, number, number, number]): void {
  track('glossary_open', { term, ref: refLabel(bookNo, chapter, verse, note) })
}

// ---------- reading ----------

/** A marker tapped open: how many footnotes and cross-references it showed. */
export function trackOpenNote(bookNo: number, chapter: number, verse: number, notes: number, crossrefs: number): void {
  track('open_note', { ref: refLabel(bookNo, chapter, verse), notes, crossrefs })
}

// ---------- copy, share, print ----------

export type CopyFrom = 'chapter' | 'chapter_highlight' | 'search' | 'compose'
export type CopyMethod = 'copy' | 'share' | 'text_selection'

/** Text leaving the app — where from, how, and how many verses / notes. */
export function trackCopy(from: CopyFrom, method: CopyMethod, count?: number): void {
  track('copy', { from, method, count })
}

export function trackPrint(from: 'compose'): void {
  track('print', { from })
}

// ---------- settings, scan ----------

/** A setting the reader changed, as its stored value. (Not `value`: GA4 reads
 * that parameter as a monetary amount and drops text.) */
export function trackSetting(name: string, value: string | number | boolean): void {
  track('setting', { name, setting_value: String(value) })
}

let fontSizeTimer: number | undefined
/** The slider reports every step of a drag; the size the reader settles on is
 * the one worth counting. */
export function trackFontSize(px: number): void {
  if (!enabled) return
  window.clearTimeout(fontSizeTimer)
  fontSizeTimer = window.setTimeout(() => trackSetting('font_size', px), 1500)
}

export function trackScan(): void {
  track('scan')
}
