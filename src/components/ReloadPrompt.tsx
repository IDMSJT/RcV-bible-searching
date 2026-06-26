import { useRegisterSW } from 'virtual:pwa-register/react'

/** Bottom toast shown when the service worker has a new build ready. The app
 * uses registerType: 'prompt', so nothing swaps until the user taps 重新載入 —
 * you never get reloaded mid-read. */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      // pointer-events-auto: vaul sets `body { pointer-events: none }` while a
      // modal drawer is open, which would otherwise make this top-most toast
      // unclickable. Re-enable it for the toast (same trick the bottom nav uses).
      className="pointer-events-auto fixed inset-x-3 bottom-[calc(var(--nav-h)+0.75rem)] z-[100] flex h-14 items-center gap-3 rounded-xl border border-border bg-popover/95 px-4 text-sm text-popover-foreground shadow-lg backdrop-blur md:inset-x-auto md:right-3 md:bottom-3 md:max-w-sm"
    >
      <span className="flex-1">有新版本可用</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95"
      >
        重新載入
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="rounded-lg px-3 py-2 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95"
      >
        稍後
      </button>
    </div>
  )
}
