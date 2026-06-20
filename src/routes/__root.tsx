import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { BookOpen, ClipboardList, Search, Settings } from 'lucide-react'
import { BOOK_BY_NO } from '@/data/canon'
import { LookupPanel } from '@/components/LookupPanel'
import { CatalogPanel } from '@/components/CatalogPanel'
import { ComposePanel } from '@/components/ComposePanel'
import { SettingsPanel } from '@/components/SettingsPanel'
import { ReadingPreferences } from '@/components/ReadingPreferences'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'

export const Route = createRootRoute({
  component: RootComponent,
})

type SidebarMode = 'catalog' | 'lookup' | 'compose' | 'settings'

function RootComponent() {
  const { pathname } = useLocation()
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

  const [mode, setMode] = useLocalStorage<SidebarMode>('rcv/sidebar-mode', 'catalog')
  const effectiveMode: SidebarMode = onCompose ? 'compose' : mode
  // Remember the last chapter URL the user was actually reading on; the 閱讀
  // nav button uses this as the jump-target whenever we leave a non-chapter
  // route (e.g. /compose) so clicking it always lands back in a verse view
  // rather than just opening the catalog over nothing. Default to 太1:1.
  const [lastChapter, setLastChapter] = useLocalStorage('rcv/last-chapter', '/40/1')
  // Mobile-only: the sidebar content lives inside a Drawer below md. On desktop
  // the aside is permanently visible and this flag is ignored.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigate = useNavigate()

  // Vaul's `onOpenChange` is just `(open: boolean) => void` — it doesn't tell
  // us which event caused the close. Instead of guessing with a timeout, we
  // mirror the most recent pointerdown target from a document-level capture
  // listener and consult it synchronously in the close handler: if the last
  // pointerdown landed inside the bottom nav, the close request came from a
  // mode-swap tap and we ignore it. Vaul still closes normally from swipe-
  // down, escape, etc., because those events update `lastPointerTargetRef` (or
  // leave it as some unrelated element).
  const lastPointerTargetRef = useRef<EventTarget | null>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastPointerTargetRef.current = e.target
    }
    document.addEventListener('pointerdown', onDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onDown, { capture: true })
  }, [])

  // Close the mobile drawer when the user navigates to a chapter view from
  // catalog — that's the "I picked something to read" path, so the reading
  // pane should be unobstructed. Nav-driven chapter switches that aren't
  // catalog (lookup/settings tapped from /compose, which forces a goToLast-
  // Chapter to release the compose lock) keep the drawer open so the user
  // sees the panel they actually asked for. Catalog book-picks and /compose
  // navigation are unaffected because their pathnames don't match the
  // chapter regex.
  useEffect(() => {
    if (/^\/\d+\/\d+/.test(pathname)) {
      // Track the last chapter URL — feeds the 閱讀 nav button below.
      setLastChapter(pathname)
      if (mode === 'catalog') setDrawerOpen(false)
    }
  }, [pathname, setLastChapter, mode])

  // Persist 'compose' as the active mode whenever we're on /compose so that
  // when the user clicks through to a verse the saved mode still makes sense
  // (otherwise we'd inherit whatever mode happened to be active before they
  // landed on /compose — lookup, settings, etc. — and the sidebar would
  // suddenly snap to a panel the user wasn't expecting).
  useEffect(() => {
    if (onCompose) setMode('compose')
  }, [onCompose, setMode])

  // Per-pathname scroll restoration for the <main> element. TanStack Router's
  // `scrollToTopSelectors` resets main → 0 on every navigation (push AND pop),
  // so the browser's back-button doesn't bring you back to where you were —
  // it always lands at the top. We mirror the scroll offset into sessionStorage
  // on every scroll, then in a layout effect re-apply the saved value after the
  // router's reset has run. sessionStorage is bounded to the current tab.
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>('[data-scroll-restoration-id="main"]')
    if (!main) return
    const key = `rcv/scroll${pathname}`
    const saved = sessionStorage.getItem(key)
    if (saved !== null) {
      const y = Number(saved)
      // Two rAFs: first frame lets the router's scroll-to-top fire; second
      // frame overrides it with the saved position before paint.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          main.scrollTop = y
        })
      })
    }
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        sessionStorage.setItem(key, String(main.scrollTop))
      })
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [pathname])

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
    if (onNav) onNav()
    // Below md the drawer is the visible part — flip it open. On desktop the
    // aside is permanently mounted, so we skip the state change: otherwise
    // vaul's overlay (which has no md:hidden) would dim the page and its body-
    // lock would pause scrolling, both for no visible reason.
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) {
      setDrawerOpen(true)
    }
  }

  // size-5 on mobile (more thumb-friendly), size-4 on desktop where they sit in
  // the slim left rail.
  const navIcon = 'size-5 md:size-4'
  // The first three buttons are identical on both viewports; settings differs
  // — on desktop it opens a Popover anchored to the button, on mobile it stays
  // a regular nav that swaps the drawer into settings mode.
  const goToLastChapter = () => {
    // Already in a book route (chapter view or outline) — don't yank the user
    // out of what they're reading. The catalog panel updates around them.
    if (/^\/\d+/.test(pathname)) return
    const m = lastChapter.match(/^\/(\d+)\/(\d+)/)
    if (!m) return
    navigate({
      to: '/$bookNo/$chapterNo',
      params: { bookNo: Number(m[1]), chapterNo: Number(m[2]) },
      search: {},
    })
  }

  // When the user is in the middle of reading a chapter and the drawer is up
  // (showing settings / lookup / compose / catalog on top of the page), the
  // 閱讀 button's job is simply "take me back to reading" — dismiss the
  // drawer regardless of which mode it was. Otherwise fall through to the
  // standard openMode flow so the off-chapter case (e.g. /compose → tap
  // 閱讀) still navigates to the last chapter.
  const onCatalogClick = () => {
    if (/^\/\d+\/\d+/.test(pathname) && drawerOpen) {
      setDrawerOpen(false)
      return
    }
    openMode('catalog', goToLastChapter)
  }

  const sharedNavButtons = (
    isActive: (m: SidebarMode) => boolean,
    catalogLabel: string,
  ) => (
    <>
      <NavButton
        active={isActive('catalog')}
        label={catalogLabel}
        onClick={onCatalogClick}
      >
        <BookOpen className={navIcon} />
      </NavButton>
      <NavButton
        active={isActive('lookup')}
        label="查詢"
        // On /compose the sidebar is forced to 'compose'; without a nav-away
        // the lookup tap would silently set the mode but the panel would stay
        // hidden behind the lock.
        onClick={() => openMode('lookup', onCompose ? goToLastChapter : undefined)}
      >
        <Search className={navIcon} />
      </NavButton>
      <NavButton
        active={isActive('compose')}
        label="綱要"
        onClick={() => openMode('compose', () => navigate({ to: '/compose' }))}
      >
        <ClipboardList className={navIcon} />
      </NavButton>
    </>
  )

  const [settingsOpen, setSettingsOpen] = useState(false)

  // Stable callback so CatalogPanel's memoized BookPicker / ChapterPicker
  // children don't re-render on every root render — without this every prev/
  // next chapter URL change cascades through the 66 Tooltip wrappers.
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // Sidebar body, shared between desktop aside and mobile drawer. Its outer
  // width is set by the wrapper (aside on desktop, drawer on mobile).
  const sidebarBody =
    effectiveMode === 'lookup' ? (
      <LookupPanel onNavigate={closeDrawer} />
    ) : effectiveMode === 'compose' ? (
      <ComposePanel />
    ) : effectiveMode === 'settings' ? (
      <SettingsPanel />
    ) : (
      <CatalogPanel
        activeBookNo={activeBookNo}
        activeChapterNo={activeChapterNo}
        activeBook={activeBook}
        onPick={closeDrawer}
      />
    )

  const sidebarWidth =
    effectiveMode === 'settings' ? 'md:w-[213px]' : 'md:w-[426px]'
  const sidebarFlexCol = effectiveMode === 'compose' || effectiveMode === 'settings'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-card text-foreground md:flex-row print:block print:h-auto print:overflow-visible">
      <ReadingPreferences />

      {/* Desktop: left vertical rail */}
      <nav className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-background p-2 md:flex print:hidden">
        {sharedNavButtons((m) => effectiveMode === m, '閱讀')}
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger
            render={
              <NavButton active={settingsOpen} label="設定" className="mt-auto">
                <Settings className={navIcon} />
              </NavButton>
            }
          />
          <PopoverContent
            side="right"
            align="end"
            sideOffset={6}
            className="w-72 gap-0 overflow-hidden p-0"
          >
            <SettingsPanel />
          </PopoverContent>
        </Popover>
      </nav>

      {/* Desktop: inline sidebar; hidden below md */}
      <aside
        className={cn(
          'hidden shrink-0 overflow-y-auto border-r border-border bg-background md:block print:hidden',
          sidebarFlexCol && 'md:flex md:flex-col',
          mode === 'lookup' && 'md:overflow-hidden',
          sidebarWidth,
        )}
      >
        {sidebarBody}
      </aside>

      {/* Main */}
      <main
        className="flex-1 overflow-y-auto pb-16 md:pb-0 print:overflow-visible print:pb-0"
        data-scroll-restoration-id="main"
      >
        <Outlet />
      </main>

      {/* Mobile: bottom nav bar; hidden on md and above. Buttons stretch evenly
       * across the full width so taps are easy with a thumb. */}
      <nav
        data-bottom-nav
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-[60] flex h-16 items-stretch border-t border-border bg-background [&>button]:size-auto [&>button]:flex-1 [&>button]:h-full [&>button]:rounded-none md:hidden print:hidden"
      >
        {sharedNavButtons(
          (m) => drawerOpen && effectiveMode === m,
          // Only call it 「目錄」 when the user is mid-read with the drawer
          // dismissed — the label then hints that tapping reopens the chapter
          // list. In every other state tapping ends up *navigating to* a
          // chapter (back from /compose, switching out of lookup/compose/
          // settings, etc.), so 「閱讀」 better describes what happens.
          /^\/\d+\/\d+/.test(pathname) && !drawerOpen ? '目錄' : '閱讀',
        )}
        <NavButton
          active={drawerOpen && effectiveMode === 'settings'}
          label="設定"
          // Tapping 設定 while it's already the open pane is a no-op (not a
          // toggle-close like the other buttons) — easy to hit accidentally
          // when fiddling with sliders / switches and the drawer disappearing
          // would feel like a glitch.
          onClick={() => {
            if (drawerOpen && effectiveMode === 'settings') return
            openMode('settings', onCompose ? goToLastChapter : undefined)
          }}
        >
          <Settings className={navIcon} />
        </NavButton>
      </nav>

      {/* Mobile: drawer holding the sidebar content */}
      <Drawer
        open={drawerOpen}
        onOpenChange={(o) => {
          if (!o) {
            const t = lastPointerTargetRef.current
            if (t instanceof Element && t.closest('[data-bottom-nav]')) return
          }
          setDrawerOpen(o)
        }}
      >
        <DrawerContent className="bottom-[calc(4rem-1px)]! h-[calc(100vh-4rem+1px)] md:hidden">
          <DrawerTitle className="sr-only">
            {effectiveMode === 'lookup'
              ? '查詢'
              : effectiveMode === 'compose'
                ? '綱要'
                : effectiveMode === 'settings'
                  ? '設定'
                  : '閱讀'}
          </DrawerTitle>
          <div className={cn('h-full overflow-y-auto', sidebarFlexCol && 'flex flex-col')}>
            {sidebarBody}
          </div>
        </DrawerContent>
      </Drawer>

      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </div>
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
        'inline-flex flex-col items-center justify-center gap-1.5 rounded-md transition-colors md:size-9 md:gap-0',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {children}
      <span className="text-xs leading-none md:hidden">{label}</span>
    </button>
  )
}
