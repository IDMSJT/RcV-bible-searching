import { Monitor, Moon, Sun } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'

type Theme = 'light' | 'dark' | 'system'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-muted/80 px-4 text-sm font-semibold backdrop-blur md:h-9 md:text-xs'

// All settings state lives here. The values themselves are picked up by other
// consumers (ChapterView, ReadingPreferences, …) via useLocalStorage on the
// same keys, so moving the state out of the root doesn't change behavior.
export function SettingsPanel() {
  const [theme, setTheme] = useLocalStorage<Theme>('rcv/theme', 'system')
  const [showOutline, setShowOutline] = useLocalStorage('rcv/show-outline', true)
  const [showEnglish, setShowEnglish] = useLocalStorage('rcv/show-english', false)
  const [fontSize, setFontSize] = useLocalStorage('rcv/font-size', 16)

  return (
    <>
      <h2 className={HEADER_CLS}><span>設定</span></h2>
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
          <Slider
            min={13}
            max={24}
            step={1}
            value={[fontSize]}
            onValueChange={(v) => setFontSize(Array.isArray(v) ? v[0] : v)}
            className="my-1.5"
          />
        </SettingRow>
      </div>
    </>
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
        'flex flex-auto items-center justify-center gap-1.5 rounded-md px-2 py-2.5 text-sm transition-colors md:py-1',
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
