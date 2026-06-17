import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { BookOpen, ClipboardList, Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import { CANON, BOOK_BY_NO, type CanonBook } from '@/data/canon'
import { BOOK_ABBREV } from '@/data/abbrev'
import { LookupPanel } from '@/components/LookupPanel'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'

export const Route = createRootRoute({
  component: RootComponent,
})

type SidebarMode = 'catalog' | 'lookup' | 'compose' | 'settings'
type Theme = 'light' | 'dark' | 'system'

function RootComponent() {
  const { pathname } = useLocation()
  const match = pathname.match(/^\/(\d+)(?:\/(\d+))?/)
  const activeBookNo = match ? Number(match[1]) : null
  const activeChapterNo = match && match[2] ? Number(match[2]) : null
  const activeBook = activeBookNo ? BOOK_BY_NO.get(activeBookNo) ?? null : null

  const [mode, setMode] = useLocalStorage<SidebarMode>('rcv/sidebar-mode', 'catalog')
  const [theme, setTheme] = useLocalStorage<Theme>('rcv/theme', 'system')
  const [showOutline, setShowOutline] = useLocalStorage('rcv/show-outline', true)
  const [showEnglish, setShowEnglish] = useLocalStorage('rcv/show-english', false)
  const [fontSize, setFontSize] = useLocalStorage('rcv/font-size', 16)
  const [composeInput, setComposeInput] = useLocalStorage('rcv/compose-input', '')

  // Expose the reading font-size as a CSS variable on <html>. Components opt in
  // via `font-size: var(--reading-fs)` so only the prose scales, not the chrome.
  useEffect(() => {
    document.documentElement.style.setProperty('--reading-fs', `${fontSize}px`)
  }, [fontSize])
  // Mobile-only: the sidebar content lives inside a Drawer below md. On desktop
  // the aside is permanently visible and this flag is ignored.
  const [drawerOpen, setDrawerOpen] = useState(false)
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
  const navigate = useNavigate()

  // Close the mobile drawer whenever the user navigates to a chapter view, so
  // after picking a chapter the reading pane is unobstructed. Book-outline and
  // /compose navigation keep the drawer open (book picks let the chapter list
  // follow up; compose lives in the drawer).
  useEffect(() => {
    if (/^\/\d+\/\d+/.test(pathname)) setDrawerOpen(false)
  }, [pathname])

  // After picking a book (URL = /:bookNo, no chapter), bring the chapter section
  // into view so the user sees the chapter grid immediately — without this they
  // have to scroll past the OT/NT lists to find the chapters that just appeared.
  const chapterAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'catalog' || !activeBookNo || activeChapterNo) return
    chapterAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeBookNo, activeChapterNo, mode])

  // Apply the theme; 'system' tracks the OS preference live via the media query.
  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') {
      root.classList.toggle('dark', theme === 'dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  const otBooks = CANON.filter((b) => b.testament === 'OT')
  const ntBooks = CANON.filter((b) => b.testament === 'NT')

  // The catalog now keeps 舊約, 新約 and (when there is an active book) 章節
  // permanently open; tapping a header just scrolls that section into view.

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

  // Sidebar body, shared between desktop aside and mobile drawer. Its outer
  // width is set by the wrapper (aside on desktop, drawer on mobile).
  const sidebarBody =
    mode === 'lookup' ? (
      <LookupPanel onNavigate={() => setDrawerOpen(false)} />
    ) : mode === 'compose' ? (
      <>
        <StickyHeader>綱要</StickyHeader>
        <textarea
          value={composeInput}
          onChange={(e) => setComposeInput(e.target.value)}
          placeholder="貼上綱要，右邊會列出每個點下面的經文…"
          className="flex-1 resize-none bg-transparent p-4 font-serif text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </>
    ) : mode === 'settings' ? (
      <>
        <StickyHeader>設定</StickyHeader>
        <div className="flex flex-col divide-y divide-border">
          <SettingRow label="主題" stack>
            <div className="flex gap-1 rounded-lg bg-muted p-0.5">
              <ThemeButton active={theme === 'light'} onClick={() => setTheme('light')} icon={Sun} label="淺色" />
              <ThemeButton active={theme === 'dark'} onClick={() => setTheme('dark')} icon={Moon} label="深色" />
              <ThemeButton active={theme === 'system'} onClick={() => setTheme('system')} icon={Monitor} label="系統" />
            </div>
          </SettingRow>
          <SettingRow label="顯示綱目" onClick={() => setShowOutline(!showOutline)}>
            <Switch on={showOutline} />
          </SettingRow>
          <SettingRow label="顯示英文" onClick={() => setShowEnglish(!showEnglish)}>
            <Switch on={showEnglish} />
          </SettingRow>
          <SettingRow label={`字體大小　${fontSize}px`} stack>
            <input
              type="range"
              min={13}
              max={24}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="mb-1.5 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </SettingRow>
        </div>
      </>
    ) : (
      <>
        <AccordionHeader
          label="舊約"
          stickyCls="sticky top-0 bottom-28 md:bottom-16"
          anchorCls="scroll-mt-0"
        />
        <BookSection books={otBooks} activeBookNo={activeBookNo} />
        <AccordionHeader
          label="新約"
          topBorder
          stickyCls="sticky top-14 md:top-8 bottom-14 md:bottom-8"
          anchorCls="scroll-mt-14 md:scroll-mt-8"
        />
        <BookSection books={ntBooks} activeBookNo={activeBookNo} />
        {activeBook && (
          <>
            <AccordionHeader
              label={activeBook.name}
              topBorder
              stickyCls="sticky top-28 md:top-16 bottom-0"
              anchorCls="scroll-mt-28 md:scroll-mt-16"
              anchorRef={chapterAnchorRef}
            />
            <div className="-my-px grid grid-cols-5 border-t border-l border-border md:my-0 md:gap-1 md:border-0 md:p-2">
                {Array.from({ length: activeBook.chapterCount }, (_, i) => i + 1).map((ch) => (
                  <Link
                    key={ch}
                    to="/$bookNo/$chapterNo"
                    params={{ bookNo: activeBook.bookNo, chapterNo: ch }}
                    search={{}}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      '@container flex aspect-square items-center justify-center border-r border-b border-border transition-colors md:rounded-md md:border-0',
                      activeChapterNo === ch
                        ? 'bg-secondary text-secondary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span className="text-[clamp(0.75rem,39cqw,1.125rem)]">{ch}</span>
                  </Link>
                ))}
            </div>
          </>
        )}
      </>
    )

  const sidebarWidth =
    mode === 'lookup' || mode === 'compose' ? 'md:w-[426px]' : 'md:w-[213px]'
  const sidebarFlexCol = mode === 'compose' || mode === 'settings'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Desktop: left vertical rail */}
      <nav className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card p-1.5 md:flex">
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
        <DrawerContent className="bottom-16! h-[calc(100vh-4rem)] md:hidden">
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

function SettingRow({
  label,
  children,
  stack,
  onClick,
}: {
  label: string
  children: React.ReactNode
  /** Stack label above children (for wider controls like the theme picker). */
  stack?: boolean
  /** When set, the whole row is the click target (for boolean switches). */
  onClick?: () => void
}) {
  const cls = cn(
    'gap-3 px-4 py-3',
    stack ? 'flex flex-col items-stretch' : 'flex items-center justify-between',
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, 'w-full text-left transition-colors hover:bg-muted/40')}>
        <span className="text-sm text-foreground">{label}</span>
        {children}
      </button>
    )
  }
  return (
    <div className={cls}>
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  )
}

function ThemeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Sun
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-auto items-center justify-center gap-1 rounded-md px-2 py-2.5 text-xs transition-colors md:py-1',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={label}
    >
      <Icon className="size-3.5" />
      {active && label}
    </button>
  )
}

/** Presentational switch indicator — the surrounding SettingRow handles clicks
 * so the entire row is the toggle target (good for thumbs on mobile). */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-card shadow transition-transform',
          on ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </span>
  )
}

function AccordionHeader({
  label,
  topBorder,
  stickyCls = 'sticky top-0',
  anchorCls = '',
  anchorRef: externalRef,
}: {
  label: string
  topBorder?: boolean
  /** Tailwind sticky-position classes. Pass both top-… and bottom-… utilities
   * so the header stacks at the top when its natural position is above the
   * viewport and at the bottom when it's below — both ends always visible. */
  stickyCls?: string
  /** scroll-margin-top utilities for the anchor div that mirror the sticky
   * top inset. scrollIntoView is called on this anchor (NOT the sticky button)
   * because the browser reads sticky elements' currently-stuck box position
   * as "where they are" — so clicking a bottom-stuck or top-stuck button gives
   * the wrong delta. The anchor sits at the natural flow position with no
   * sticky transform, so its position is unambiguous. */
  anchorCls?: string
  /** Optional external ref to the anchor div so the parent can trigger a
   * scroll (e.g. auto-scroll to the chapter section when a book is picked). */
  anchorRef?: React.RefObject<HTMLDivElement | null>
}) {
  const localRef = useRef<HTMLDivElement>(null)
  const ref = externalRef ?? localRef
  return (
    <>
      <div ref={ref} aria-hidden className={cn('h-0', anchorCls)} />
      <button
        type="button"
        onClick={() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className={cn(
          stickyCls,
          'z-10 flex h-14 w-full items-center justify-between border-b border-border bg-muted/80 px-4 text-sm font-semibold backdrop-blur transition-colors hover:bg-muted md:h-8 md:text-xs',
          topBorder && 'border-t',
        )}
      >
        <span>{label}</span>
      </button>
    </>
  )
}

function StickyHeader({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <h2 className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-muted/80 px-4 text-sm font-semibold backdrop-blur md:h-8 md:text-xs">
      <span>{children}</span>
      {action}
    </h2>
  )
}

function BookSection({
  books,
  activeBookNo,
}: {
  books: CanonBook[]
  activeBookNo: number | null
}) {
  return (
    <TooltipProvider delay={0}>
      <div className="-my-px grid grid-cols-5 border-t border-l border-border md:my-0 md:gap-1 md:border-0 md:p-2">
        {books.map((b) => (
          <BookGridCell key={b.bookNo} book={b} active={activeBookNo === b.bookNo} />
        ))}
      </div>
    </TooltipProvider>
  )
}

function BookGridCell({ book, active }: { book: CanonBook; active: boolean }) {
  const abbrev = BOOK_ABBREV[book.bookNo] ?? book.name.slice(0, 1)
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <Link
            to="/$bookNo"
            params={{ bookNo: book.bookNo }}
            className={cn(
              '@container flex aspect-square items-center justify-center border-r border-b border-border transition-colors md:rounded-md md:border-0',
              active
                ? 'bg-secondary text-secondary-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          />
        }
      >
        <span className="text-[clamp(0.75rem,39cqw,1.125rem)]">{abbrev}</span>
      </TooltipTrigger>
      <TooltipContent>{book.name}</TooltipContent>
    </Tooltip>
  )
}
