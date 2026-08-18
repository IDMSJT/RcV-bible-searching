/**
 * Shared look for the bits of furniture that float over a scrolling surface.
 *
 * Only the look — where a bar sits and how it lays out is the page's business,
 * and the two that use this differ there: the search panel's is a sticky
 * full-width row with a count on the left, the outline page's a compact box
 * hugging its buttons in the corner. What they have in common, and what a reader
 * recognises as the same kind of thing, is the frame: lifted off the text, its
 * own edge, and the words behind it blurred rather than hidden.
 */
export const ACTION_BAR_CLS =
  'rounded-xl border border-border bg-popover/95 shadow-lg backdrop-blur'
