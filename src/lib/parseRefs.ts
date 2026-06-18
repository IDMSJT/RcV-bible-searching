import { parseToken, type ParseCtx, type VerseRef } from './parseToken'

export type { VerseRef } from './parseToken'

export interface ParseError {
  token: string
  reason: string
}

export interface ParseResult {
  refs: VerseRef[]
  errors: ParseError[]
  /** ok / fail status for each non-empty token, in input order. */
  statuses: boolean[]
}

export interface Segment {
  text: string
  /** true for a token (parseable unit), false for a separator. */
  token: boolean
}

const SPLIT_RE = /[，、,；;\s\n]+/
const SPLIT_CAPTURE_RE = /([，、,；;\s\n]+)/
const SEP_ONLY_RE = /^[，、,；;\s\n]+$/

/** Split input into tokens and separators (for highlighting), preserving order. */
export function segmentInput(input: string): Segment[] {
  return input
    .split(SPLIT_CAPTURE_RE)
    .filter((s) => s !== '')
    .map((s) => ({ text: s, token: !SEP_ONLY_RE.test(s) }))
}

export function parseRefs(input: string): ParseResult {
  const tokens = input.split(SPLIT_RE).filter(Boolean)
  const refs: VerseRef[] = []
  const errors: ParseError[] = []
  const statuses: boolean[] = []

  const ctx: ParseCtx = { book: null, chapter: null }
  for (const token of tokens) {
    const out = parseToken(token, ctx)
    if (!out.ok) {
      errors.push({ token, reason: out.reason ?? '無法解析' })
      statuses.push(false)
      continue
    }
    refs.push(...out.refs)
    statuses.push(true)
  }

  return { refs, errors, statuses }
}
