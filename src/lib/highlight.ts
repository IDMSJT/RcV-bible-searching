/** A single `?hl=` directive. The schema is comma-separated items, each one of:
 *   - 「v」 / 「v-v」        → tint a verse / verse range in the current chapter
 *   - 「v:n」               → expand + tint footnote N on verse V
 *   - 「chA:vA-chB:vB」     → a cross-chapter verse range; the only item that
 *     carries chapter numbers, since the rest of the schema is implicitly
 *     scoped to the chapter being viewed. ChapterView clips it per chapter. */
export type HlItem =
  | { kind: 'verse'; start: number; end: number }
  | { kind: 'note'; verse: number; n: number }
  | { kind: 'crange'; startCh: number; startV: number; endCh: number; endV: number }

function serializeCrange(h: Extract<HlItem, { kind: 'crange' }>): string {
  return `${h.startCh}:${h.startV}-${h.endCh}:${h.endV}`
}

/** The `?hl=` to carry to an adjacent chapter so a cross-chapter range keeps
 * highlighting as the user pages through it. Only crange items that actually
 * cover `destCh` survive — plain verse / note items are chapter-scoped to the
 * current page and would highlight the wrong verses if carried forward.
 * Returns undefined when nothing covers `destCh` (so the link clears hl). */
export function carryHlForChapter(items: HlItem[], destCh: number): string | undefined {
  const parts = items
    .filter((h): h is Extract<HlItem, { kind: 'crange' }> => h.kind === 'crange')
    .filter((h) => destCh >= h.startCh && destCh <= h.endCh)
    .map(serializeCrange)
  return parts.length ? parts.join(',') : undefined
}

export function parseHighlight(hl: string | undefined): HlItem[] {
  if (!hl) return []
  return hl.split(',').flatMap((raw): HlItem[] => {
    const seg = raw.trim()
    // 「chA:vA-chB:vB」 — cross-chapter range. Two colons + a dash, so it can't
    // be confused with 「v:n」 (note) or 「v-v」 (same-chapter range). Tried
    // first because its 「\d+:\d+」 head would otherwise match the note arm.
    const crM = seg.match(/^(\d+):(\d+)-(\d+):(\d+)$/)
    if (crM) {
      return [
        {
          kind: 'crange',
          startCh: Number(crM[1]),
          startV: Number(crM[2]),
          endCh: Number(crM[3]),
          endV: Number(crM[4]),
        },
      ]
    }
    // 「verse:n」 — note reference (auto-expand + tint that note body).
    const noteM = seg.match(/^(\d+):(\d+)$/)
    if (noteM) return [{ kind: 'note', verse: Number(noteM[1]), n: Number(noteM[2]) }]
    // 「verse」 or 「verse-verse」 — verse range.
    const verseM = seg.match(/^(\d+)(?:-(\d+))?$/)
    if (verseM) {
      const start = Number(verseM[1])
      return [{ kind: 'verse', start, end: verseM[2] ? Number(verseM[2]) : start }]
    }
    return []
  })
}
