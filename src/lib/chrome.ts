import { cn } from '@/lib/utils'

/**
 * Shared look for the app's action bars — the row of controls that sits at the
 * foot of a surface (search results, the reading selection, the compose editor
 * and its rendered document).
 *
 * They all wear the search results' frame: a full-width row docked to the
 * bottom edge with its own top rule and a solid background, not a floating pill.
 * Where a bar sits (sticky in a scroll region, fixed over the reading surface,
 * in a column's flow) is the page's own business; this is only the frame.
 */
export const ACTION_BAR_CLS = 'flex h-13 items-center border-t border-border bg-card px-4 text-sm'

/**
 * The reading surface's bars, which are portalled to <body> so they escape the
 * carousel's transform. That also means they can't inherit the reading column's
 * box, and a bar spanning the window would run under the nav rail and the
 * sidebar — so the caller measures the column and sets `left` / `width`; only
 * the vertical placement is here. Above the bottom nav on the phone, at the
 * foot of the column on desktop, where there is no nav.
 */
export const FLOATING_ACTION_BAR_CLS = cn(
  ACTION_BAR_CLS,
  'fixed bottom-[var(--nav-h)] z-40 gap-3 md:bottom-0',
)

/** A small grey pill — the default action on a bar (分享, 清除, 合併…). */
export const ACTION_BAR_BTN =
  'rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 active:scale-95'

/** The same pill in the primary colour — the emphasised action (複製, 列印, 完成). */
export const ACTION_BAR_BTN_PRIMARY =
  'rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95'

/** A frameless icon button — the dismiss (X) on a bar. */
export const ACTION_BAR_BTN_GHOST =
  'rounded-md px-1.5 py-1 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95'
