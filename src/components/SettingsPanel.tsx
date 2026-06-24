import { Check } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'

type Theme = 'light' | 'dark' | 'system'

const HEADER_CLS =
  'sticky top-0 z-10 flex h-14 items-center justify-center border-b border-border bg-muted/80 px-4 text-base font-normal backdrop-blur md:h-9 md:justify-between md:text-xs md:font-semibold'

// All settings state lives here. The values themselves are picked up by other
// consumers (ChapterView, ReadingPreferences, …) via useLocalStorage on the
// same keys, so moving the state out of the root doesn't change behavior.
export function SettingsPanel() {
  const [theme, setTheme] = useLocalStorage<Theme>('rcv/theme', 'system')
  const [showOutline, setShowOutline] = useLocalStorage('rcv/show-outline', true)
  const [showEnglish, setShowEnglish] = useLocalStorage('rcv/show-english', false)
  const [showNotes, setShowNotes] = useLocalStorage('rcv/show-notes', true)
  const [fontSize, setFontSize] = useLocalStorage('rcv/font-size', 16)

  return (
    <>
      <h2 className={HEADER_CLS}><span>設定</span></h2>
      <div className="flex flex-col divide-y divide-border">
        <SettingRow label="顯示綱目" onClick={() => setShowOutline(!showOutline)}>
          <Switch on={showOutline} />
        </SettingRow>
        <SettingRow label="顯示英文" onClick={() => setShowEnglish(!showEnglish)}>
          <Switch on={showEnglish} />
        </SettingRow>
        <SettingRow label="顯示註釋" onClick={() => setShowNotes(!showNotes)}>
          <Switch on={showNotes} />
        </SettingRow>
        {/* Cross-references live inside annotations in our EPUB source, so a
         * standalone 串珠 toggle would need a different data set. Keep it
         * planned but disabled. */}
        <SettingRow label="顯示串珠" disabled>
          <Switch on={false} disabled />
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
        <SettingRow label="主題" stack>
          <div className="grid grid-cols-3 gap-3 pt-1">
            <ThemeSwatch active={theme === 'light'} onClick={() => setTheme('light')} variant="light" label="淺色" />
            <ThemeSwatch active={theme === 'dark'} onClick={() => setTheme('dark')} variant="dark" label="深色" />
            <ThemeSwatch active={theme === 'system'} onClick={() => setTheme('system')} variant="system" label="系統" />
          </div>
        </SettingRow>
      </div>
      <p className="mt-auto px-4 py-4 text-center text-xs text-muted-foreground">
        v{__APP_VERSION__}
      </p>
    </>
  )
}

function SettingRow({
  label,
  children,
  stack,
  onClick,
  disabled,
}: {
  label: string
  children: React.ReactNode
  /** Stack label above children (for wider controls like the theme picker). */
  stack?: boolean
  /** When set, the whole row is the click target (for boolean switches). */
  onClick?: () => void
  /** Renders the row as a non-interactive, muted placeholder — used for
   * settings that are listed but not implemented yet. */
  disabled?: boolean
}) {
  const cls = cn(
    'gap-3 px-4 py-4 md:py-3',
    stack ? 'flex flex-col items-stretch' : 'flex items-center justify-between',
  )
  if (onClick || disabled) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          cls,
          'w-full text-left transition-colors',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/40',
        )}
      >
        <span className="text-base text-foreground md:text-sm">{label}</span>
        {children}
      </button>
    )
  }
  return (
    <div className={cls}>
      <span className="text-base text-foreground md:text-sm">{label}</span>
      {children}
    </div>
  )
}

// Literal preview colours for each theme, hardcoded (not the CSS vars, which
// flip with the *current* theme) so every swatch always shows its own palette
// regardless of which theme is active — mirrors the app's real light/dark tokens.
type Palette = { frame: string; card: string; ink: string }
const SWATCH: Record<'light' | 'dark', Palette> = {
  light: { frame: 'oklch(0.93 0.018 84)', card: 'oklch(0.987 0.013 82.4)', ink: 'oklch(0.305 0.024 238.8)' },
  dark: { frame: 'oklch(0.34 0.032 249)', card: 'oklch(0.19 0.024 246)', ink: 'oklch(0.899 0.030 80.7)' },
}

/** One mini preview tile: a frame with a bottom-right "Aa" panel. */
function Preview({ palette }: { palette: Palette }) {
  return (
    <div className="absolute inset-0" style={{ background: palette.frame }}>
      <div
        className="absolute inset-y-[26%] inset-x-[26%] bottom-0 right-0 flex items-center rounded-tl-xl pl-[14%] font-bold"
        style={{ background: palette.card, color: palette.ink }}
      >
        Aa
      </div>
    </div>
  )
}

function ThemeSwatch({
  active,
  onClick,
  variant,
  label,
}: {
  active: boolean
  onClick: () => void
  variant: 'light' | 'dark' | 'system'
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className="flex flex-col items-center gap-2 focus:outline-none"
    >
      <span
        className={cn(
          'relative block aspect-[4/3] w-full overflow-hidden rounded-2xl text-base transition-shadow',
          active ? 'ring-2 ring-primary' : 'ring-1 ring-border',
        )}
      >
        {variant === 'system' ? (
          <span className="absolute inset-0 flex">
            <span className="relative block w-1/2 overflow-hidden">
              <Preview palette={SWATCH.dark} />
            </span>
            <span className="relative block w-1/2 overflow-hidden">
              <Preview palette={SWATCH.light} />
            </span>
          </span>
        ) : (
          <Preview palette={SWATCH[variant]} />
        )}
        {active && (
          <span className="absolute bottom-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Check className="size-3 [stroke-width:3]" />
          </span>
        )}
      </span>
      <span className={cn('text-sm font-medium md:text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </button>
  )
}

/** Presentational switch indicator — the surrounding SettingRow handles clicks
 * so the entire row is the toggle target (good for thumbs on mobile). */
function Switch({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-disabled={disabled}
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
