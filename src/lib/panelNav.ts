import type { AnyRouter } from '@tanstack/react-router'

/** The bottom drawer (phone) is a `?panel=` search param, so the system back
 * gesture dismisses it like any other page and a reload comes back to it. */
export const PANELS = ['books', 'chapters', 'charts', 'settings', 'compose'] as const
export type Panel = (typeof PANELS)[number]

export function parsePanel(v: unknown): Panel | undefined {
  return PANELS.find((p) => p === v)
}

// The catalog's panes, in the order they sit in the swipe strip.
const CATALOG_PANELS: Panel[] = ['books', 'chapters', 'charts']
export type CatalogPane = 0 | 1 | 2
export const paneOf = (p: Panel | undefined): CatalogPane => {
  const i = CATALOG_PANELS.indexOf(p as Panel)
  return (i < 0 ? 1 : i) as CatalogPane
}
export const panelOfPane = (pane: CatalogPane): Panel => CATALOG_PANELS[pane]

export type PanelMode = 'catalog' | 'settings' | 'compose'
export function modeOf(p: Panel): PanelMode {
  return p === 'settings' || p === 'compose' ? p : 'catalog'
}

/** A saved href minus the drawer: coming back to a chapter must not reopen it. */
export function withoutPanel(href: string): string {
  const [path, query] = href.split('?')
  if (!query) return href
  const params = new URLSearchParams(query)
  params.delete('panel')
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

/**
 * History policy for the drawer.
 *
 * - Opening pushes one entry, marked `panelPushed` — its predecessor is the
 *   very page it covers, so dismissing can simply go back.
 * - Switching panels while open replaces, so a swipe through the panes leaves
 *   one entry, not one per pane.
 * - Dismissing goes back if it was pushed; otherwise (a reload, a shared link,
 *   or the page behind it changed) it rewrites the entry without the param.
 *
 * Whatever navigates away should pass `replace: nav.isOpen()` so it takes the
 * drawer's entry over instead of stacking on it — except where coming back to
 * the drawer is the point (opening a chart).
 */
// Set when the app itself asked for the pop (a tap closing the drawer), so the
// popstate that follows isn't mistaken for the reader's back gesture.
let ownPop = false
export function takeOwnPop(): boolean {
  const v = ownPop
  ownPop = false
  return v
}

export function panelNav(router: AnyRouter) {
  const loc = () => router.state.location
  const current = () => parsePanel(loc().search.panel)
  return {
    current,
    isOpen: () => current() != null,
    open(panel: Panel) {
      const open = current() != null
      router.navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, panel }),
        replace: open,
        state: open ? true : { panelPushed: true },
        // The drawer's own slide is the transition; a cross-fade of the page
        // snapshot over it is what read as the drawer popping up twice.
        viewTransition: false,
      } as never)
    },
    close() {
      if (current() == null) return
      if ((loc().state as { panelPushed?: boolean }).panelPushed) {
        ownPop = true
        setTimeout(() => (ownPop = false), 700)
        router.history.back()
      } else {
        router.navigate({
          search: (prev: Record<string, unknown>) => ({ ...prev, panel: undefined }),
          replace: true,
          viewTransition: false,
        } as never)
      }
    },
  }
}
