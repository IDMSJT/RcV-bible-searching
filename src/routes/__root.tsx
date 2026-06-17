import { useEffect, useState } from 'react'
import { Link, Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { BookOpen, ChevronDown, ClipboardList, Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import { CANON, BOOK_BY_NO, type CanonBook } from '@/data/canon'
import { BOOK_ABBREV } from '@/data/abbrev'
import { LookupPanel } from '@/components/LookupPanel'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  const [composeInput, setComposeInput] = useLocalStorage('rcv/compose-input', '')
  const navigate = useNavigate()

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

  // Catalog accordion — 舊約 and 新約 can both be open, but 章節 is mutually
  // exclusive with the book lists. Auto-switches to 章節 when a book becomes
  // active (e.g. user picked one from the list).
  type CatalogSection = 'OT' | 'NT' | 'chapters'
  const [openSections, setOpenSections] = useState<Set<CatalogSection>>(() =>
    activeBook ? new Set(['chapters']) : new Set(['OT', 'NT']),
  )
  useEffect(() => {
    if (activeBookNo != null) setOpenSections(new Set(['chapters']))
  }, [activeBookNo])
  // Valid states are exactly: {chapters} | {OT, NT} | {OT} | {NT}.
  // The book lists and the chapter grid are mutually exclusive, and at least
  // one section is always open (clicking the sole-open OT or NT is a no-op).
  const toggleSection = (s: CatalogSection) =>
    setOpenSections((prev) => {
      if (s === 'chapters') {
        return prev.has('chapters') ? new Set(['OT', 'NT']) : new Set(['chapters'])
      }
      if (prev.has('chapters')) return new Set([s])
      if (prev.has(s)) return prev.size > 1 ? new Set([s === 'OT' ? 'NT' : 'OT']) : prev
      const next = new Set(prev)
      next.add(s)
      return next
    })

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Nav rail */}
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card p-1.5">
        <NavButton active={mode === 'catalog'} label="目錄" onClick={() => setMode('catalog')}>
          <BookOpen className="size-4" />
        </NavButton>
        <NavButton active={mode === 'lookup'} label="查詢" onClick={() => setMode('lookup')}>
          <Search className="size-4" />
        </NavButton>
        <NavButton
          active={mode === 'compose'}
          label="綱要"
          onClick={() => {
            setMode('compose')
            navigate({ to: '/compose' })
          }}
        >
          <ClipboardList className="size-4" />
        </NavButton>
        <NavButton
          active={mode === 'settings'}
          label="設定"
          onClick={() => setMode('settings')}
          className="mt-auto"
        >
          <Settings className="size-4" />
        </NavButton>
      </nav>

      {mode === 'lookup' ? (
        <aside className="w-[426px] shrink-0 overflow-hidden border-r border-border bg-card">
          <LookupPanel />
        </aside>
      ) : mode === 'compose' ? (
        <aside className="flex w-[426px] shrink-0 flex-col border-r border-border bg-card">
          <StickyHeader>綱要</StickyHeader>
          <textarea
            value={composeInput}
            onChange={(e) => setComposeInput(e.target.value)}
            placeholder="貼上綱要，右邊會列出每個點下面的經文…"
            className="flex-1 resize-none bg-transparent p-4 font-serif text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
          />
        </aside>
      ) : mode === 'settings' ? (
        <aside className="flex w-[213px] shrink-0 flex-col border-r border-border bg-card">
          <StickyHeader>設定</StickyHeader>
          <div className="flex flex-col divide-y divide-border">
            <SettingRow label="主題" stack>
              <div className="flex gap-1 rounded-lg bg-muted p-0.5">
                <ThemeButton active={theme === 'light'} onClick={() => setTheme('light')} icon={Sun} label="淺色" />
                <ThemeButton active={theme === 'dark'} onClick={() => setTheme('dark')} icon={Moon} label="深色" />
                <ThemeButton active={theme === 'system'} onClick={() => setTheme('system')} icon={Monitor} label="系統" />
              </div>
            </SettingRow>
            <SettingRow label="顯示綱目">
              <Switch on={showOutline} onChange={() => setShowOutline(!showOutline)} />
            </SettingRow>
            <SettingRow label="顯示英文">
              <Switch on={showEnglish} onChange={() => setShowEnglish(!showEnglish)} />
            </SettingRow>
          </div>
        </aside>
      ) : (
        <aside className="w-[213px] shrink-0 overflow-y-auto border-r border-border bg-card">
          <AccordionHeader
            label="舊約"
            open={openSections.has('OT')}
            onClick={() => toggleSection('OT')}
          />
          {openSections.has('OT') && <BookSection books={otBooks} activeBookNo={activeBookNo} />}
          <AccordionHeader
            label="新約"
            open={openSections.has('NT')}
            onClick={() => toggleSection('NT')}
            topBorder
          />
          {openSections.has('NT') && <BookSection books={ntBooks} activeBookNo={activeBookNo} />}
          {activeBook && (
            <>
              <AccordionHeader
                label={activeBook.name}
                open={openSections.has('chapters')}
                onClick={() => toggleSection('chapters')}
                topBorder
              />
              {openSections.has('chapters') && (
              <div className="grid grid-cols-5 gap-1 p-2">
                {Array.from({ length: activeBook.chapterCount }, (_, i) => i + 1).map((ch) => (
                  <Link
                    key={ch}
                    to="/$bookNo/$chapterNo"
                    params={{ bookNo: activeBook.bookNo, chapterNo: ch }}
                    search={{}}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-md text-sm transition-colors',
                      activeChapterNo === ch
                        ? 'bg-secondary text-secondary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {ch}
                  </Link>
                ))}
              </div>
              )}
            </>
          )}
        </aside>
      )}

      {/* Main */}
      <main className="flex-1 overflow-y-auto" data-scroll-restoration-id="main">
        <Outlet />
      </main>

      <TanStackRouterDevtools position="bottom-right" />
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
        'inline-flex size-9 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

function SettingRow({
  label,
  children,
  stack,
}: {
  label: string
  children: React.ReactNode
  /** Stack label above children (for wider controls like the theme picker). */
  stack?: boolean
}) {
  return (
    <div
      className={cn(
        'gap-3 px-4 py-3',
        stack ? 'flex flex-col items-stretch' : 'flex items-center justify-between',
      )}
    >
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
        'flex flex-auto items-center justify-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
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

function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
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
    </button>
  )
}

function AccordionHeader({
  label,
  open,
  onClick,
  topBorder,
}: {
  label: string
  open: boolean
  onClick: () => void
  topBorder?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'sticky top-0 z-10 flex h-8 w-full items-center justify-between border-b border-border bg-muted/80 px-4 text-xs font-semibold backdrop-blur transition-colors hover:bg-muted',
        topBorder && 'border-t',
      )}
    >
      <span>{label}</span>
      <ChevronDown
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-180',
        )}
      />
    </button>
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
    <h2 className="sticky top-0 z-10 flex h-8 items-center justify-between border-b border-border bg-muted/80 px-4 text-xs font-semibold backdrop-blur">
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
      <div className="grid grid-cols-5 gap-1 p-2">
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
              'flex aspect-square items-center justify-center rounded-md text-sm transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          />
        }
      >
        {abbrev}
      </TooltipTrigger>
      <TooltipContent>{book.name}</TooltipContent>
    </Tooltip>
  )
}
