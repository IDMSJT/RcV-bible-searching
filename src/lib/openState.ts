import type { Open } from '@/lib/renderVerse'

/**
 * What a chapter has open, as one thing.
 *
 * A note card, a cross-reference card, and the citation a reader opened inside
 * one of them were three separate entries in sessionStorage. They are not three
 * independent facts: a citation only exists inside a card, and when the card
 * goes the citation goes with it. Keeping them apart meant every operation had
 * to remember to touch all of them, and one already didn't — the reload that
 * clears the open notes left the open cross-references behind.
 *
 * So: one key per chapter, holding one list.
 *
 *   ["n7:1:2", "n7:2", "r7:a:0"]
 *
 * Each entry names an open card, and may end with the citation open inside it.
 * The leading letter is the kind, `n` for a footnote and `r` for a
 * cross-reference; what follows is the verse and the marker, which is how the
 * cards are already identified everywhere else.
 *
 * Read the fields by counting, never by prefix — 「n7:1」 is a prefix of
 * 「n7:10」, which is a different card.
 */
export interface OpenState {
  /** Open footnote cards, keyed 「verse:n」. */
  notes: Set<string>
  /** Open cross-reference cards, keyed 「verse:marker」. */
  refs: Set<string>
  /** Which citation is open inside a card, keyed by the card with its kind
   * letter in front — 「n7:1」, 「r7:a」. A card with nothing open is absent. */
  cites: Record<string, Open>
}

export function emptyOpenState(): OpenState {
  return { notes: new Set(), refs: new Set(), cites: {} }
}

/** Read the stored list. Anything unrecognised is dropped rather than guessed
 * at: the state is a convenience, and a wrong guess reopens the wrong card. */
export function parseOpen(raw: unknown): OpenState {
  const out = emptyOpenState()
  if (!Array.isArray(raw)) return out
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const parts = entry.split(':')
    if (parts.length < 2 || parts.length > 3) continue
    const kind = parts[0][0]
    const id = `${parts[0].slice(1)}:${parts[1]}`
    if (kind === 'n') out.notes.add(id)
    else if (kind === 'r') out.refs.add(id)
    else continue
    if (parts.length === 3) {
      const at = Number(parts[2])
      if (Number.isInteger(at) && at >= 0) out.cites[`${kind}${id}`] = at
    }
  }
  return out
}

/** The list to store. A citation whose card is closed is left out, so a card
 * put away and opened again comes back as it would the first time. */
export function serializeOpen(state: OpenState): string[] {
  const out: string[] = []
  const emit = (kind: 'n' | 'r', ids: Set<string>) => {
    for (const id of ids) {
      const at = state.cites[`${kind}${id}`]
      out.push(at == null ? `${kind}${id}` : `${kind}${id}:${at}`)
    }
  }
  emit('n', state.notes)
  emit('r', state.refs)
  return out
}
