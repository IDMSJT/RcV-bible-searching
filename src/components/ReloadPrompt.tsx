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
      className="fixed inset-x-3 bottom-[calc(var(--nav-h)+0.75rem)] z-[100] flex items-center gap-3 rounded-xl border border-border bg-popover/95 px-4 py-3 text-sm text-popover-foreground shadow-lg backdrop-blur md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm"
    >
      <span className="flex-1">有新版本可用</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        重新載入
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        稍後
      </button>
    </div>
  )
}
