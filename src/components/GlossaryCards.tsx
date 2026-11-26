import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BOOK_ABBREV } from '@/data/abbrev'
import { useGlossary, type Glossary } from '@/data/loadBible'
import { trackGlossaryOpen, trackGlossaryView } from '@/lib/analytics'

// Cards shown before 「還有 N 個相關詞」: the best match (the word itself when
// there is one); words that contain it (耶和華 → 耶和華以勒 …) on request.
const MAX_CARDS = 1
// Explanations shown in one card before 「還有 N 則」 — a common word (恩典) has
// many. The general one comes first (build_glossary.py orders them).
const MAX_DEFS = 1

// Same look as a result row's reference (LookupPanel): the footnote link is
// exactly that; the word top left is the same, set bold as the card's title.
const LABEL_CLS = 'font-sans text-[0.8em] tabular-nums text-primary'

type Entry = Glossary['entries'][number]

/** The entries a keyword search is about: the word itself first, then words
 * that contain what was typed (以勒 → 耶和華以勒) or that it contains. A
 * one-character word only on an exact match — 但 is a tribe, and also in
 * every third verse. */
function matchEntries(glossary: Glossary, query: string): Entry[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const exact: Entry[] = []
  const near: Entry[] = []
  for (const e of glossary.entries) {
    if (tokens.includes(e.term)) exact.push(e)
    else if (
      e.term.length >= 2 &&
      tokens.some((t) => t.length >= 2 && (e.term.includes(t) || t.includes(e.term)))
    )
      near.push(e)
  }
  return [...exact, ...near]
}

/** 名詞解釋 above the keyword results: what the word means, from the footnote
 * that explains it, with a link to that footnote. */
export function GlossaryCards({ query, onNavigate }: { query: string; onNavigate?: () => void }) {
  // Keyed by the query so a new search starts folded again.
  return <GlossaryCardList key={query.trim()} query={query} onNavigate={onNavigate} />
}

function GlossaryCardList({ query, onNavigate }: { query: string; onNavigate?: () => void }) {
  const wanted = query.trim().length > 0
  const { data } = useGlossary(wanted)
  const entries = useMemo(() => (data && wanted ? matchEntries(data, query) : []), [data, query, wanted])
  const [all, setAll] = useState(false)
  // Analytics: which word's card a search brought up.
  const shownTerm = entries[0]?.term
  useEffect(() => {
    if (shownTerm) trackGlossaryView(shownTerm)
  }, [shownTerm])
  if (entries.length === 0) return null
  const shown = all ? entries : entries.slice(0, MAX_CARDS)
  const hidden = entries.length - shown.length
  return (
    <div className="mb-2 flex flex-col gap-2">
      {shown.map((e) => (
        <GlossaryCard key={e.term} entry={e} onNavigate={onNavigate} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="self-start font-sans text-xs text-muted-foreground hover:text-foreground"
        >
          還有 {hidden} 個相關詞
        </button>
      )}
    </div>
  )
}

// Scripture references in brackets — 「（民十三16，）」「（出三14，參約八24，28，58，）」
// — are left out of the card; the footnote itself is a tap away. Only brackets
// holding a digit: 「（Darby，達祕。）」 stays.
const REF_PARENS = /（[^（）]*[0-9][^（）]*）/g

function RefLinks({
  refs,
  term,
  onNavigate,
}: {
  refs: [number, number, number, number][]
  term: string
  onNavigate?: () => void
}) {
  return refs.map(([b, c, v, n]) => (
    <Link
      key={`${b}.${c}.${v}.${n}`}
      to="/$bookNo/$chapterNo"
      params={{ bookNo: b, chapterNo: c }}
      // Note 0: the verse itself explains the word (約1:38 拉比繙出來，就是夫子).
      search={{ hl: n ? `${v}:${n}` : `${v}` }}
      onClick={() => {
        trackGlossaryOpen(term, [b, c, v, n])
        onNavigate?.()
      }}
      className={`ml-1.5 whitespace-nowrap ${LABEL_CLS} hover:text-primary/80`}
    >
      {BOOK_ABBREV[b]}
      {c}:{v}
      {n ? `註${n}` : ''}
    </Link>
  ))
}

function GlossaryCard({ entry, onNavigate }: { entry: Entry; onNavigate?: () => void }) {
  const [allDefs, setAllDefs] = useState(false)
  // A card shows the meaning: the note's first sentence, its bracketed
  // references left out. The whole note is behind the link after it.
  const short = (t: string) => {
    const i = t.indexOf('。')
    return (i < 0 ? t : t.slice(0, i + 1)).replace(REF_PARENS, '')
  }
  // Explanations that read the same once shortened are one — 瑪拉 is
  // 「意，苦。」 at 出15:23 and at 得1:20 — so their footnotes go together.
  const shown = entry.defs.reduce<Entry['defs']>((acc, d) => {
    const t = short(d.text)
    const same = acc.find((x) => x.text === t)
    if (same) same.refs = [...same.refs, ...d.refs]
    else acc.push({ text: t, refs: d.refs })
    return acc
  }, [])
  const defs = allDefs ? shown : shown.slice(0, MAX_DEFS)
  const hiddenDefs = shown.length - defs.length
  return (
    <section className="rounded-md bg-muted/40 px-3 py-2 font-serif text-[length:calc(var(--reading-fs,1rem)*0.9375)] leading-relaxed">
      <h3 className={`${LABEL_CLS} font-semibold`}>{entry.term}</h3>
      {defs.map((d, i) => (
        // flow-root holds the floated references inside the paragraph.
        <p key={i} className="flow-root text-foreground/90">
          {d.text}
          {/* Floated after the text: on its last line, pushed to the right edge
           * when there's room there, else on a line of its own, still right. */}
          <span className="float-right">
            <RefLinks refs={d.refs} term={entry.term} onNavigate={onNavigate} />
          </span>
        </p>
      ))}
      {hiddenDefs > 0 && (
        <button
          type="button"
          onClick={() => setAllDefs(true)}
          className="mt-0.5 font-sans text-xs text-muted-foreground hover:text-foreground"
        >
          還有 {hiddenDefs} 則
        </button>
      )}
    </section>
  )
}
