import { X } from 'lucide-react'
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { RELEASE_NOTES } from '@/data/releaseNotes'

// Same header as the other sidebar panels (SettingsPanel / ComposePanel):
// centred title on mobile, smaller left-aligned title on desktop.
const HEADER_CLS =
  'sticky top-0 z-10 flex h-[var(--header-h)] shrink-0 items-center justify-center border-b border-border bg-muted/80 px-4 text-base font-medium backdrop-blur md:h-9 md:justify-between md:text-xs md:font-semibold'

/** Tap-the-version "what's new" list. A bottom sheet on touch (dismiss by drag,
 * so no close button there); on desktop the `md:` overrides float it into a
 * centred, fully-rounded card with an X, so it reads like a dialog. Controlled
 * from __root so it never nests inside the settings drawer / aside. */
export function ChangelogDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80dvh] md:inset-x-0 md:bottom-6 md:mx-auto md:max-w-md md:rounded-2xl md:border md:shadow-xl">
        <DrawerTitle className="sr-only">版本紀錄</DrawerTitle>
        <div className={HEADER_CLS}>
          <span>版本紀錄</span>
          <DrawerClose
            aria-label="關閉"
            className="hidden size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
          >
            <X className="size-4" />
          </DrawerClose>
        </div>
        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain pb-[var(--nav-h)] md:pb-0">
          {RELEASE_NOTES.map((r) => (
            <section key={r.version} className="px-4 py-4">
              <div className="mb-2.5 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-foreground">版本 {r.version}</h3>
                {r.date && <span className="text-xs text-muted-foreground">{r.date}</span>}
              </div>
              <ul className="space-y-2">
                {r.notes.map((n, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <span aria-hidden className="mt-[0.5em] size-1 shrink-0 rounded-full bg-primary/60" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
