import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A nav icon, gold inside its own outline while its tab is open.
 *
 * Two copies rather than a fill on one: an svg paints in document order and
 * lucide draws each icon as several paths, so a fill on a later one hides what
 * came before it — the book's spine, the cog's centre, a clipboard's lines.
 * With the fill on a copy underneath and the outline on the copy above, nothing
 * of the drawing is lost and the fill can stay solid.
 *
 * Both copies are positioned. Order in the markup isn't enough on its own: an
 * absolutely positioned box paints above everything still in flow, whatever
 * came first, so the fill would cover the outline it is meant to sit behind.
 * Positioned siblings fall back to document order, which is what was wanted.
 */
export function NavIcon({
  icon: Icon,
  active,
  className,
}: {
  icon: LucideIcon
  active: boolean
  className?: string
}) {
  return (
    <span className="relative inline-flex">
      {active && (
        <Icon aria-hidden className={cn(className, 'absolute inset-0 fill-primary/70 [stroke:none]')} />
      )}
      <Icon className={cn(className, 'relative', active && 'stroke-secondary-foreground')} />
    </span>
  )
}
