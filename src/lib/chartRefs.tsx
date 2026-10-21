import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

// 「見圖七」「如圖九」 and the two charts that notes sometimes name outright.
// A bare 圖N is not enough — it has to follow 見 / 如 / 參 — so a word that
// merely contains 圖 never turns into a link. Charts are numbered in the order
// of the list, which is the order the notes count them in.
const NUMERALS = '一二三四五六七八九'
const BY_NAME: Record<string, number> = {
  七十個七與基督來臨並聖徒被提圖: 6,
  諸天之國與神的國分別圖: 8,
}
const PATTERN = new RegExp(
  `([見如參])圖([${NUMERALS}])|${Object.keys(BY_NAME).join('|')}`,
  'g',
)

/** Plain text with its chart references made into links to the chart page. */
export function linkCharts(text: string): ReactNode {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(PATTERN)) {
    const n = m[2] ? NUMERALS.indexOf(m[2]) + 1 : BY_NAME[m[0]]
    // For 「見圖七」 only 「圖七」 is the link; the 見 stays as prose.
    const from = m.index + (m[1] ? 1 : 0)
    if (from > at) out.push(text.slice(at, from))
    out.push(
      <Link
        key={from}
        to="/charts/$n"
        params={{ n: String(n) }}
        viewTransition={false}
        // Note bodies sit inside rows and cards with taps of their own.
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-primary hover:text-primary/80"
      >
        {text.slice(from, m.index + m[0].length)}
      </Link>,
    )
    at = m.index + m[0].length
  }
  if (out.length === 0) return text
  if (at < text.length) out.push(text.slice(at))
  return <Fragment>{out}</Fragment>
}
