import { formatOutlineRange, displayMarker } from '@/lib/chinese'
import { cn } from '@/lib/utils'
import type { OutlineEntry } from '@/types/bible'

/**
 * One outline heading's text: its marker, its title, and the verses it covers.
 *
 * Two columns rather than a run of inline spans, so a title that wraps carries
 * on under itself instead of back beneath the marker. The markers are not all
 * one width — 一 beside 十一, （一） beside a — so the column is sized per
 * heading rather than shared, and a heading with no marker takes both.
 *
 * Inline-grid, not grid: the tint has to hug the text the way the inline span it
 * replaces did, rather than reach the full width of the row.
 *
 * Shared by the outline panel and the headings printed through a chapter, which
 * had drifted into two copies of the same markup.
 */
export function OutlineLabel({
  entry,
  highlight,
  scrubbed,
  instant,
}: {
  entry: OutlineEntry
  highlight?: boolean
  /** The 經節軌 is held over this heading: grey, and instant — it has to keep
   * up with a finger, so it skips the fade the hover tint has. */
  scrubbed?: boolean
  /** No colour fade at all. The tint going *away* — the finger moving on to the
   * next heading, or lifting — would otherwise fade out even if it came in
   * instantly, since the transition belongs to the style being changed to. */
  instant?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-grid grid-cols-[auto_1fr] gap-x-1.5 rounded px-1 -mx-1 transition-colors group-hover:bg-muted',
        highlight && 'bg-highlight/25',
        scrubbed && !highlight && 'bg-muted text-foreground',
        instant && 'transition-none',
      )}
    >
      {/* tabular-nums so 「1」 and 「2」 occupy the same width and the titles of
        * sibling headings start at one place; the CJK markers are fixed-width
        * already. */}
      {entry.marker && <span className="tabular-nums">{displayMarker(entry.marker)}</span>}
      <span className={cn('min-w-0', !entry.marker && 'col-span-2')}>
        {entry.title}
        {entry.continued && ' (續)'}
        {entry.range && (
          <span className="ml-1.5 text-muted-foreground/60">{formatOutlineRange(entry.range)}</span>
        )}
      </span>
    </span>
  )
}
