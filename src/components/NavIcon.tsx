import type { LucideIcon } from 'lucide-react'

/**
 * A nav icon — just the glyph.
 *
 * Its colour (gold, via text-primary/currentColor, when its tab is active) and
 * its stroke weight come from the NavButton around it, so an active tab reads as
 * a gold outline rather than a filled shape.
 */
export function NavIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon className={className} />
}
