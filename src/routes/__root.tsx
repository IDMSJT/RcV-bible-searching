import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { BookOpen, FileText, Menu, Search, Settings } from 'lucide-react'
import { BOOK_BY_NO } from '@/data/canon'
import { BOOK_ABBREV } from '@/data/abbrev'
import { LookupPanel } from '@/components/LookupPanel'
import { CatalogPanel } from '@/components/CatalogPanel'
import { ComposePanel } from '@/components/ComposePanel'
import { NavIcon } from '@/components/NavIcon'
import { SettingsPanel } from '@/components/SettingsPanel'
import { ReadingPreferences } from '@/components/ReadingPreferences'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { ChangelogDrawer } from '@/components/ChangelogDrawer'
import { ScanProvider } from '@/components/ScanProvider'
import { SwUpdate } from '@/components/SwUpdate'
import { HISTORY_KEY, recordVisit, removeVisit, type Visit } from '@/lib/readingHistory'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

export const Route = createRootRoute({
  component: RootComponent,
})

type SidebarMode = 'catalog' | 'lookup' | 'compose' | 'settings'

// Vaul snap points keyed by mode. Catalog / lookup / compose only have a
// single snap at full. Settings is short content (slider, theme toggle) so
// it opens at 0.7 and can be pulled to full if the user wants room.
const DRAWER_SNAPS_FULL: (number | string)[] = [1]
const DRAWER_SNAPS_SETTINGS: (number | string)[] = [0.7, 1]
function snapsFor(mode: SidebarMode): (number | string)[] {
  return mode === 'settings' ? DRAWER_SNAPS_SETTINGS : DRAWER_SNAPS_FULL
}
function initialSnapFor(mode: SidebarMode): number {
  return mode === 'settings' ? 0.7 : 1
}

function RootComponent() {
  const location = useLocation()
  const { pathname } = location
  // Read the focus params from the router's reactive location, NOT
  // window.location — the router updates its own location state before it
  // flushes the URL to the history API, so window.location.search can still
  // be the *previous* page's query string when our layout effect runs.
  const match = pathname.match(/^\/(\d+)(?:\/(\d+))?/)
  const activeBookNo = match ? Number(match[1]) : null
  const activeChapterNo = match && match[2] ? Number(match[2]) : null
  const activeBook = activeBookNo ? BOOK_BY_NO.get(activeBookNo) ?? null : null
  // The /compose route is itself the outline document — we don't want a catalog
  // / lookup / settings panel rendering on top of it. While we're on /compose
  // the sidebar is locked to 'compose' regardless of the persisted mode; the
  // other nav buttons therefore navigate the user off /compose first so the
  // requested mode can actually surface (see goToLastChapter usages below).
  const onCompose = pathname === '/compose'
  // Search is a route only on the phone — a full page in <main>, so the system
  // back gesture dismisses it and its scroll is remembered like any other page.
  // On desktop it stays in the aside (see the redirect effect below).
  const onSearch = pathname === '/search'
  const isMobile = useIsMobile()

  const [mode, setMode] = useLocalStorage<SidebarMode>('rcv/sidebar-mode', 'catalog')
  // Lets a panel show over /compose without leaving it — settings, say, which
  // has nothing to do with the document being written. Deliberately not
  // persisted and cleared on navigation, so arriving at /compose always brings
  // back the editor rather than whatever was last opened on top of it.
  const [composeOverlay, setComposeOverlay] = useState<SidebarMode | null>(null)
  useEffect(() => {
    setComposeOverlay(null)
  }, [pathname])
  const effectiveMode: SidebarMode = onCompose ? composeOverlay ?? 'compose' : mode
  // Remember the last chapter URL the user was actually reading on; the 閱讀
  // nav button uses this as the jump-target whenever we leave a non-chapter
  // route (e.g. /compose) so clicking it always lands back in a verse view
  // rather than just opening the catalog over nothing. Default to 太1:1.
  const [lastChapter, setLastChapter] = useLocalStorage('rcv/last-chapter', '/40/1')
  // Off the reading surface, the left nav button jumps back to that chapter — so
  // name it by book + chapter (e.g. 詩46) instead of a generic 「閱讀」, which
  // says what tapping it returns you to.
  const lastCh = lastChapter.match(/^\/(\d+)\/(\d+)/)
  const readingLabel = lastCh ? `${BOOK_ABBREV[Number(lastCh[1])] ?? ''}${Number(lastCh[2])}` : '閱讀'
  // Mobile-only: the sidebar content lives inside a Drawer below md. On desktop
  // the aside is permanently visible and this flag is ignored.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSnap, setDrawerSnap] = useState<number | string | null>(1)
  const [changelogOpen, setChangelogOpen] = useState(false)
  // Which catalog pane the mobile drawer shows (0 = books, 1 = chapters). Lifted
  // here so the bottom-nav button can cycle reading → chapters → books → reading.
  const [catalogPane, setCatalogPane] = useState<0 | 1>(1)
  // Whether settings is the surface on mobile. The desktop aside is always
  // there, so `effectiveMode` alone answers it; on mobile the drawer has to be
  // open too, since the mode outlives a dismiss.
  const settingsOpen = drawerOpen && effectiveMode === 'settings'
  const navigate = useNavigate()

  // Vaul's `onOpenChange` is just `(open: boolean) => void` — it doesn't tell
  // us which event caused the close. Instead of guessing with a timeout, we note
  // from a document-level capture listener whether the most recent pointerdown
  // landed inside the bottom nav and consult that in the close handler: if it
  // did, the close came from a mode-swap tap that onNavTap already handles, so
  // we ignore it. Vaul still closes normally from a swipe-down / press elsewhere
  // (those update the flag to false) — escape leaves it, but the drawer is
  // mobile-only, where escape isn't a factor.
  //
  // A boolean settled at pointerdown, not the target element consulted later:
  // a nav tap swaps the button's icon, so the tapped <svg> is gone from the DOM
  // by the time vaul's close fires, and `.closest()` on a detached node returns
  // null — which used to let the close through and shut the drawer mid-cycle.
  const lastPointerInNavRef = useRef(false)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target
      lastPointerInNavRef.current = t instanceof Element && !!t.closest('[data-bottom-nav]')
    }
    document.addEventListener('pointerdown', onDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onDown, { capture: true })
  }, [])

  // Track the last chapter URL the user navigated to — feeds the 閱讀 nav
  // button. The drawer-close-on-chapter-nav step that used to live here was
  // redundant (CatalogPanel.onPick and LookupPanel.onNavigate already call
  // closeDrawer themselves) and re-ran on every mode change because `mode`
  // had to be in the deps, which caused a second tap on the catalog nav
  // from lookup to silently close the drawer back down. Leave drawer state
  // alone here; explicit callbacks own it.
  // Store the full href (with ?hl / ?oh / ?oe), not just the path, so returning
  // to the last chapter lands back on the verse / note / outline heading that
  // was open — 詩46 read back to where you were looking.
  useEffect(() => {
    if (/^\/\d+\/\d+/.test(pathname)) setLastChapter(location.href)
  }, [location.href, pathname, setLastChapter])

  // The chapters the reader has opened, for the catalog's 歷史 list. Recorded
  // here rather than at each link because every way in — the catalog, a search
  // result, a citation, the desktop arrows, the back button — passes through a
  // pathname change. The one route that doesn't count is the carousel swipe,
  // which raises a flag pushVisit consumes (see readingHistory.ts).
  const [history, setHistory] = useLocalStorage<Visit[]>(HISTORY_KEY, [])
  useEffect(() => {
    if (activeBookNo == null || activeChapterNo == null) return
    const next = recordVisit(activeBookNo, activeChapterNo, Date.now())
    if (next) setHistory(next)
  }, [activeBookNo, activeChapterNo, setHistory])
  // Stable, so the memoized book grid (and its 66 tooltips) doesn't rebuild
  // every render — the list it sits beside now lives in the same pane.
  const removeHistoryEntry = useCallback(
    (v: Visit) => setHistory(removeVisit(v.bookNo, v.chapterNo)),
    [setHistory],
  )

  // Reset the drawer snap whenever the displayed panel changes — settings
  // opens at half, everything else at full. Vaul animates between snaps.
  useEffect(() => {
    setDrawerSnap(initialSnapFor(effectiveMode))
  }, [effectiveMode])

  // Saved mode is tightly coupled to the route: 'compose' iff we're on
  // /compose, everything else gets demoted to 'catalog' so the sidebar
  // doesn't keep showing the compose panel after the user navigates away.
  // The fallback is catalog rather than the last non-compose mode because
  // there's no record of what was active before /compose anyway.
  useEffect(() => {
    if (onCompose) setMode('compose')
    else if (mode === 'compose') setMode('catalog')
  }, [onCompose, mode, setMode])

  // /search is a phone-only page. If a desktop lands on it — a shared link, or
  // the viewport widening while it's open — bounce to the last chapter and open
  // the aside in lookup mode, which is where search lives at that width.
  useEffect(() => {
    if (!onSearch || isMobile) return
    setMode('lookup')
    const m = lastChapter.match(/^\/(\d+)\/(\d+)/)
    navigate({
      to: '/$bookNo/$chapterNo',
      params: { bookNo: Number(m?.[1] ?? 40), chapterNo: Number(m?.[2] ?? 1) },
      search: {},
      replace: true,
    })
  }, [onSearch, isMobile, lastChapter, navigate, setMode])

  // Drop ephemeral reading state on a hard refresh. sessionStorage normally
  // survives same-tab reload, but the user wants refresh to feel like a
  // fresh load — so on initial mount, if the document was reloaded, clear the
  // per-pathname scroll positions and everything a chapter had open. In-app
  // navigation (back / forward / Link clicks) is unaffected. The open state is
  // one key now; it used to be two, and only one of them was listed here, so
  // the cross-references quietly outlived every refresh.
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav?.type !== 'reload') return
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && (k.startsWith('rcv/scroll') || k.startsWith('rcv/open'))) {
        keys.push(k)
      }
    }
    keys.forEach((k) => sessionStorage.removeItem(k))
  }, [])

  // Scroll restoration lives in ScrollBody, which every scrolling page uses.

  // If the viewport crosses from mobile to desktop while the drawer is open
  // (rare but possible — rotate, resize), force it closed so we don't keep
  // vaul mounted on a layout that doesn't show its content.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = () => { if (mq.matches) setDrawerOpen(false) }
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const openMode = (m: SidebarMode, onNav?: () => void) => {
    // Tapping the lit nav button while its drawer is already open closes it
    // (the nav button acts as a toggle for the current mode). Compare against
    // effectiveMode so the toggle still fires correctly on /compose, where the
    // displayed mode is the forced 'compose' rather than the persisted one.
    if (m === effectiveMode && drawerOpen) {
      setDrawerOpen(false)
      return
    }
    setMode(m)
    // On /compose the sidebar belongs to the document, so anything else shows
    // as an overlay on top of it instead of replacing the persisted mode.
    if (onCompose) setComposeOverlay(m === 'compose' ? null : m)
    if (onNav) onNav()
    // Arriving at /compose is the exception: there the drawer is the editor and
    // the page behind it is the outline itself, so it stays down. An outline is
    // pasted once and read many times, so the visit that wants the editor is
    // the rare one — tapping 綱要 again, now that we are here, is what opens it,
    // which is what the empty state behind it already says to do.
    //
    // Closed, not merely left alone: the tap may have come from a chapter with
    // the catalog drawer already up, and that one would otherwise stay open and
    // just swap to the editor.
    if (m === 'compose' && !onCompose) {
      setDrawerOpen(false)
      return
    }
    // Below md the drawer is the visible part — flip it open. On desktop the
    // aside is permanently mounted, so we skip the state change: otherwise
    // vaul's overlay (which has no md:hidden) would dim the page and its body-
    // lock would pause scrolling, both for no visible reason.
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) {
      setDrawerOpen(true)
    }
  }

  // Same icon size on both viewports — desktop now stacks icon + label
  // Slack-style in a wider rail, so the icon doesn't need to shrink. Mobile
  // gets a larger, thinner icon than desktop — at that size a heavier line
  // reads as clumsy. Stroke-width goes through CSS so it can be responsive at
  // all; the lucide prop can't be.
  const navIcon = 'size-6 [stroke-width:1.4] md:size-5 md:[stroke-width:1.6]'
  // All four nav buttons behave the same on both viewports: swap the active
  // panel (desktop aside / mobile drawer) into that mode.
  const goToLastChapter = () => {
    // Only the chapter view is "what they're reading" — outline (/$bookNo) and
    // /compose are meta routes, so 閱讀 should still navigate the user into an
    // actual chapter from there.
    if (/^\/\d+\/\d+/.test(pathname)) return
    const [path, queryStr] = lastChapter.split('?')
    const m = path.match(/^\/(\d+)\/(\d+)/)
    if (!m) return
    // Carry back the highlight / open-note / open-heading it was left on.
    const search: Record<string, string> = {}
    if (queryStr) new URLSearchParams(queryStr).forEach((v, k) => (search[k] = v))
    navigate({
      to: '/$bookNo/$chapterNo',
      params: { bookNo: Number(m[1]), chapterNo: Number(m[2]) },
      search,
    })
  }

  // Every nav button taps through here. The four targets are genuinely
  // different — search and compose are routes, the catalog is a drawer that
  // cycles panes, settings is a plain drawer — so this is a switch rather than a
  // one-liner; the point is that all the nav behaviour lives in one place.
  const onNavTap = (target: SidebarMode) => {
    if (target === 'lookup') {
      // Phone: search is its own page. Dismiss any overlay (settings can sit
      // over it), then go unless we're already there. Desktop: the aside, opened
      // like the rest; tapping the open one is a no-op.
      if (isMobile) {
        setDrawerOpen(false)
        if (!onSearch) navigate({ to: '/search' })
      } else if (!(drawerOpen && effectiveMode === 'lookup')) {
        openMode('lookup', onCompose ? goToLastChapter : undefined)
      }
      return
    }

    if (target === 'compose') {
      // On /compose the outline is the surface, so this toggles the editor
      // drawer (closing also dismisses a settings overlay). From elsewhere,
      // navigate to /compose — arriving keeps the editor down (see openMode).
      if (!onCompose) openMode('compose', () => navigate({ to: '/compose' }))
      else if (drawerOpen) setDrawerOpen(false)
      else {
        setComposeOverlay(null)
        setMode('compose')
        setDrawerOpen(true)
      }
      return
    }

    if (target === 'settings') {
      // The button toggles: tapping it with settings already up puts the drawer
      // away. On desktop settingsOpen is never true, so this is just openMode
      // there.
      if (settingsOpen) closeDrawer()
      else openMode('settings')
      return
    }

    // target === 'catalog' — the left button.
    // On a meta route (/compose, /search) it means "leave for something
    // readable" — even with a drawer up (settings can overlay /search), close it
    // and go.
    if (onCompose || onSearch) {
      setDrawerOpen(false)
      goToLastChapter()
      return
    }
    // Reading, on the phone: cycle reading → chapter pane → book pane → reading.
    if (isMobile && /^\/\d+/.test(pathname)) {
      if (drawerOpen && effectiveMode === 'catalog') {
        if (catalogPane === 1) setCatalogPane(0) // chapters → books
        else closeDrawer() // books → back to reading, chapter pane ready again
      } else if (drawerOpen) {
        closeDrawer() // some other panel (settings) over reading → close it
      } else {
        setCatalogPane(1) // reading → open onto the chapter pane
        openMode('catalog')
      }
      return
    }
    // Desktop reading (no pane cycle): toggle the catalog.
    if (drawerOpen) setDrawerOpen(false)
    else openMode('catalog')
  }

  // The left button's label names its next stop in the reading cycle: from
  // reading it opens the chapter pane (選章 — or 綱目 on an outline page, which
  // has no chapter to pick into); on the chapter pane it moves to books (選書);
  // on the book pane it returns to the chapter (詩46). Off the reading surface it
  // just says the chapter it returns to.
  const catalogNavLabel =
    drawerOpen && effectiveMode === 'catalog'
      ? catalogPane === 1
        ? '選書'
        : readingLabel
      : /^\/\d+/.test(pathname) && !drawerOpen
        ? activeChapterNo != null
          ? '選章'
          : '綱目'
        : readingLabel
  // The button steps *into* the catalog (menu icon) when reading with the drawer
  // shut, or on the chapter pane heading for books; otherwise it points back to
  // reading (book icon). Derived here rather than by matching the label, so the
  // outline page's 綱目 counts as a step in without being a third string to list.
  const catalogIsMenuStep =
    (/^\/\d+/.test(pathname) && !drawerOpen) ||
    (drawerOpen && effectiveMode === 'catalog' && catalogPane === 1)

  const sharedNavButtons = (
    isActive: (m: SidebarMode) => boolean,
    catalogLabel: string,
    catalogIsMenu = false,
  ) => (
    <>
      <NavButton
        active={isActive('catalog')}
        label={catalogLabel}
        onClick={() => onNavTap('catalog')}
      >
        {/* A menu icon while the button is a step into the catalog; the book
          * once it points back to reading. */}
        <NavIcon icon={catalogIsMenu ? Menu : BookOpen} className={navIcon} />
      </NavButton>
      <NavButton
        active={isActive('lookup')}
        label="搜尋"
        onClick={() => onNavTap('lookup')}
      >
        <NavIcon icon={Search} className={navIcon} />
      </NavButton>
      <NavButton
        active={isActive('compose')}
        label="綱要"
        onClick={() => onNavTap('compose')}
      >
        <NavIcon icon={FileText} className={navIcon} />
      </NavButton>
    </>
  )

  // Stable callback so CatalogPanel's memoized BookPicker / ChapterPicker
  // children don't re-render on every root render — without this every prev/
  // next chapter URL change cascades through the 66 Tooltip wrappers.
  // A dismissed drawer forgets it was left on the book pane: the catalog is for
  // picking a chapter, so that's the pane waiting the next time it opens.
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setCatalogPane(1)
  }, [])

  // Sidebar body, shared between desktop aside and mobile drawer. Its outer
  // width is set by the wrapper (aside on desktop, drawer on mobile).
  const sidebarBody =
    effectiveMode === 'lookup' ? (
      <LookupPanel onNavigate={closeDrawer} />
    ) : effectiveMode === 'compose' ? (
      <ComposePanel onDone={closeDrawer} />
    ) : effectiveMode === 'settings' ? (
      <SettingsPanel onShowChangelog={() => setChangelogOpen(true)} />
    ) : (
      <CatalogPanel
        activeBookNo={activeBookNo}
        activeChapterNo={activeChapterNo}
        activeBook={activeBook}
        onPick={closeDrawer}
        pane={catalogPane}
        onPaneChange={setCatalogPane}
        history={history}
        onRemoveHistory={removeHistoryEntry}
      />
    )

  // Settings is a single narrow column of rows, so it gets a tighter width than
  // the content-heavy panels (catalog / lookup / compose).
  const sidebarWidth = effectiveMode === 'settings' ? 'md:w-[320px]' : 'md:w-[426px]'
  const sidebarFlexCol = effectiveMode === 'compose' || effectiveMode === 'settings'

  return (
    // The viewfinder is held out here. It is opened from a button inside the
    // lookup panel, and the layout moves that panel between a drawer and a
    // sidebar as the phone turns — which unmounted the camera mid-scan.
    <ScanProvider>
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-card pt-[env(safe-area-inset-top)] text-foreground md:flex-row md:pt-0 print:block print:h-auto print:overflow-visible">
      <ReadingPreferences />

      {/* Desktop: left vertical rail */}
      <nav className="hidden w-16 shrink-0 flex-col items-center border-r border-border bg-background p-2 md:flex print:hidden">
        {/* Desktop always names the chapter (詩46) — reading, it's where you are;
          * off a book route, it's what the button returns you to. */}
        {sharedNavButtons((m) => effectiveMode === m, readingLabel)}
        <NavButton
          active={effectiveMode === 'settings'}
          label="設定"
          className="mt-auto"
          onClick={() => onNavTap('settings')}
        >
          <NavIcon icon={Settings} className={navIcon} />
        </NavButton>
      </nav>

      {/* Desktop: inline sidebar; hidden below md */}
      <aside
        className={cn(
          // overflow-x-hidden clips the fixed-width inner while the aside's width
          // animates, so the content lands at its final layout immediately and
          // only the box glides.
          'hidden shrink-0 overflow-x-hidden overflow-y-auto border-r border-border bg-background transition-[width] duration-200 ease-out md:block print:hidden',
          sidebarFlexCol && 'md:flex md:flex-col',
          effectiveMode === 'lookup' && 'md:overflow-hidden',
          sidebarWidth,
        )}
      >
        {/* Desktop aside swaps panels instantly — the mobile drawer is where
         * the fade lives (see DrawerContent below). On the wide layout the
         * sidebar is always visible and the user is usually clicking from
         * one panel directly into another, so a fade reads as a delay. */}
        {/* Fixed to the mode's width (no transition) so the content doesn't
         * reflow while the aside box animates around it. */}
        <div
          key={effectiveMode}
          className={cn('h-full', sidebarFlexCol && 'flex flex-col', sidebarWidth)}
        >
          {sidebarBody}
        </div>
      </aside>

      {/* Main — a non-scrolling flex column. The actual scrolling happens in
       * each route's <ScrollBody>, so page headers rendered as its siblings
       * (chapter / outline titles) stay put instead of scrolling under an
       * overscroll bounce. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <Outlet />
      </main>

      <SwUpdate />

      {/* Mobile: bottom nav bar; hidden on md and above. Buttons stretch evenly
       * across the full width so taps are easy with a thumb. */}
      <nav
        data-bottom-nav
        // Reserve a bit less than the full home-indicator inset (minus 0.75rem,
        // floored at 0) so the centred buttons sit a touch lower — without
        // changing --nav-h (sticky offsets depend on it). No safe-area → 0.
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-[60] flex h-[var(--nav-h)] items-stretch border-t border-border bg-background pb-[max(0px,calc(env(safe-area-inset-bottom)-0.75rem))] [&>button]:size-auto [&>button]:flex-1 [&>button]:h-full [&>button]:rounded-none md:hidden print:hidden"
      >
        {sharedNavButtons(
          // While the drawer is open, light the tab whose panel it shows.
          // While it's dismissed, light the tab matching the current surface:
          // 綱要 on /compose, 目錄 while reading a chapter (the article itself
          // is the surface, so the tab reflects route context, not the drawer).
          (m) => {
            if (drawerOpen) return effectiveMode === m
            if (onSearch) return m === 'lookup'
            if (onCompose) return m === 'compose'
            if (/^\/\d+/.test(pathname)) return m === 'catalog'
            return false
          },
          catalogNavLabel,
          catalogIsMenuStep,
        )}
        <NavButton
          // The drawer is what makes settings the surface: `effectiveMode`
          // only remembers which pane it last held, so it still says
          // 'settings' after a dismiss. Read by the icon too — when the two
          // were written out separately they drifted, and a dismissed drawer
          // left the gear filled beside a lit 目錄.
          active={settingsOpen}
          label="設定"
          onClick={() => onNavTap('settings')}
        >
          <NavIcon icon={Settings} className={navIcon} />
        </NavButton>
      </nav>

      {/* Mobile: drawer holding the sidebar content */}
      <Drawer
        open={drawerOpen}
        onOpenChange={(o) => {
          // A bottom-nav tap drives its own open/close through onNavTap; ignore
          // vaul's close for it so a pane-swap tap doesn't also shut the drawer.
          if (!o && lastPointerInNavRef.current) return
          if (!o) setCatalogPane(1)
          setDrawerOpen(o)
        }}
        snapPoints={snapsFor(effectiveMode)}
        activeSnapPoint={drawerSnap}
        setActiveSnapPoint={setDrawerSnap}
        // Vaul's default input-focus repositioning tugs the drawer up to keep
        // the focused field above the keyboard, but on iOS it leaves the
        // drawer stuck at the keyboard-time height after dismiss.
        repositionInputs={false}
      >
        {/* Full-height to bottom-0 with bottom padding so content stays above
         * the bottom nav (z-[60], on top of the sheet's z-50, still tappable).
         * vaul's closed transform is translate3d(0, var(--initial-transform,
         * 100%)) — 100% would be the full sheet height (a whole screen, too far)
         * so we pin --initial-transform to exactly the nav top: the sheet slides
         * just far enough to clear the visible area, then unmounts. */}
        <DrawerContent
          style={
            {
              '--initial-transform': 'calc(100dvh - var(--nav-h))',
            } as CSSProperties
          }
          className="h-[100dvh] pb-[calc(var(--nav-h)-1px)] md:hidden"
          // The scanner is opened from in here but rendered on the body, so to
          // a modal drawer every tap in it reads as a tap outside — which
          // dismissed the drawer the reader is meant to come back to with their
          // citations. It is not outside; it is this panel, full screen.
          onInteractOutside={(e) => {
            if ((e.target as Element | null)?.closest?.('[data-scanner]')) e.preventDefault()
          }}
        >
          <DrawerTitle className="sr-only">
            {effectiveMode === 'lookup'
              ? '經節'
              : effectiveMode === 'compose'
                ? '綱要'
                : effectiveMode === 'settings'
                  ? '設定'
                  : '閱讀'}
          </DrawerTitle>
          <div
            key={effectiveMode}
            className={cn(
              'h-full animate-in fade-in duration-600',
              // Only scroll the content at the top snap. At a lower snap
              // (settings' 0.7) keep it overflow-hidden so a drag expands the
              // drawer to full first, instead of scrolling and expanding at once.
              drawerSnap === 1 ? 'overflow-y-auto' : 'overflow-hidden',
              sidebarFlexCol && 'flex flex-col',
            )}
          >
            {sidebarBody}
          </div>
        </DrawerContent>
      </Drawer>

      <ChangelogDrawer open={changelogOpen} onOpenChange={setChangelogOpen} />

      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </div>
    </ScanProvider>
  )
}

function NavButton({
  active,
  label,
  onClick,
  className,
  children,
  ...rest
}: {
  active: boolean
  label: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
} & Omit<React.ComponentPropsWithoutRef<'button'>, 'onClick' | 'className' | 'children'>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      {...rest}
      className={cn(
        // Active is a colour change only — the icon + label go gold
        // (text-primary), no filled chip. currentColor carries it to the SVG.
        'group inline-flex flex-col items-center justify-center gap-1.5 rounded-md transition-colors md:p-2',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center',
          // Desktop-only: square icon chip with its own hover / active bg —
          // its colour transition lives here. On mobile the icon has no
          // transition of its own; it inherits the button's animated colour
          // (currentColor), so icon + label change colour in lock-step.
          'md:size-9 md:rounded-md md:transition-colors',
          // No fill on the active chip — the gold text does the work. Inactive
          // still gets a hover chip on desktop.
          !active && 'md:group-hover:bg-muted md:group-hover:text-foreground',
          // The open tab's icon outline thickens a step on either viewport, on
          // top of the gold.
          active && '[&_svg]:[stroke-width:1.6] md:[&_svg]:[stroke-width:1.8]',
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          'text-xs leading-none md:text-[11px] md:font-medium',
          // Mobile: bolder label on the active tab; desktop keeps font-medium.
          active ? 'font-semibold' : 'font-medium',
        )}
      >
        {label}
      </span>
    </button>
  )
}
