import { useCallback, useEffect, useRef, useState } from 'react'
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

  const [mode, setMode] = useLocalStorage<SidebarMode>('rcv/sidebar-mode', 'catalog')
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

  // Close the mobile drawer whenever the user navigates to a chapter view, so
  // after picking a chapter the reading pane is unobstructed. Book-outline and
  // /compose navigation keep the drawer open (book picks let the chapter list
  // follow up; compose lives in the drawer).
  useEffect(() => {
    if (/^\/\d+\/\d+/.test(pathname)) setDrawerOpen(false)
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
    // (the nav button acts as a toggle for the current mode).
    if (m === mode && drawerOpen) {
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
  // Desktop sidebar is always visible so the lit nav button matches `mode`.
  // On mobile the drawer is the visible part, so the nav button only lights up
  // when the drawer is actually open (a tap that closes the drawer therefore
  // dims its own button immediately).
  const navButtons = (isActive: (m: SidebarMode) => boolean) => (
    <>
      <NavButton active={isActive('catalog')} label="閱讀" onClick={() => openMode('catalog')}>
        <BookOpen className={navIcon} />
      </NavButton>
      <NavButton active={isActive('lookup')} label="查詢" onClick={() => openMode('lookup')}>
        <Search className={navIcon} />
      </NavButton>
      <NavButton
        active={isActive('compose')}
        label="綱要"
        onClick={() => openMode('compose', () => navigate({ to: '/compose' }))}
      >
        <ClipboardList className={navIcon} />
      </NavButton>
      <NavButton
        active={isActive('settings')}
        label="設定"
        onClick={() => openMode('settings')}
        className="md:mt-auto"
      >
        <Settings className={navIcon} />
      </NavButton>
    </>
  )

  // Stable callback so CatalogPanel's memoized BookPicker / ChapterPicker
  // children don't re-render on every root render — without this every prev/
  // next chapter URL change cascades through the 66 Tooltip wrappers.
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // Sidebar body, shared between desktop aside and mobile drawer. Its outer
  // width is set by the wrapper (aside on desktop, drawer on mobile).
  const sidebarBody =
    mode === 'lookup' ? (
      <LookupPanel onNavigate={closeDrawer} />
    ) : mode === 'compose' ? (
      <ComposePanel />
    ) : mode === 'settings' ? (
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
    mode === 'settings' ? 'md:w-[213px]' : 'md:w-[426px]'
  const sidebarFlexCol = mode === 'compose' || mode === 'settings'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
      <ReadingPreferences />

      {/* Desktop: left vertical rail */}
      <nav className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card p-2 md:flex">
        {navButtons((m) => mode === m)}
      </nav>

      {/* Desktop: inline sidebar; hidden below md */}
      <aside
        className={cn(
          'hidden shrink-0 overflow-y-auto border-r border-border bg-card md:block',
          sidebarFlexCol && 'md:flex md:flex-col',
          mode === 'lookup' && 'md:overflow-hidden',
          sidebarWidth,
        )}
      >
        {sidebarBody}
      </aside>

      {/* Main */}
      <main
        className="flex-1 overflow-y-auto pb-16 md:pb-0"
        data-scroll-restoration-id="main"
      >
        <Outlet />
      </main>

      {/* Mobile: bottom nav bar; hidden on md and above. Buttons stretch evenly
       * across the full width so taps are easy with a thumb. */}
      <nav
        data-bottom-nav
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-[60] flex h-16 items-stretch border-t border-border bg-card [&>button]:size-auto [&>button]:flex-1 [&>button]:h-full [&>button]:rounded-none md:hidden"
      >
        {navButtons((m) => drawerOpen && mode === m)}
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
            {mode === 'lookup'
              ? '查詢'
              : mode === 'compose'
                ? '綱要'
                : mode === 'settings'
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
}: {
  active: boolean
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
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
