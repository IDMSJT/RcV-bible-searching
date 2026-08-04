import { describe, expect, it } from 'vitest'
import { parseOpen, serializeOpen, type OpenState } from './openState'

const state = (
  notes: string[] = [],
  refs: string[] = [],
  cites: Record<string, number> = {},
): OpenState => ({ notes: new Set(notes), refs: new Set(refs), cites })

const plain = (s: OpenState) => ({
  notes: [...s.notes],
  refs: [...s.refs],
  cites: s.cites,
})

describe('parseOpen', () => {
  it('reads a card with and without a citation', () => {
    expect(plain(parseOpen(['n7:1:2', 'n7:2', 'r7:a:0']))).toEqual({
      notes: ['7:1', '7:2'],
      refs: ['7:a'],
      cites: { 'n7:1': 2, 'r7:a': 0 },
    })
  })

  it('tells 「n7:1」 from 「n7:10」, which prefix matching would not', () => {
    const out = parseOpen(['n7:1:2', 'n7:10:5'])
    expect([...out.notes]).toEqual(['7:1', '7:10'])
    expect(out.cites).toEqual({ 'n7:1': 2, 'n7:10': 5 })
  })

  it('keeps citation zero, which is a real citation', () => {
    expect(parseOpen(['n7:1:0']).cites).toEqual({ 'n7:1': 0 })
  })

  it('drops what it cannot read instead of guessing', () => {
    const out = parseOpen(['x7:1', 'n7', 'n7:1:2:3', 'n7:1:nope', 'n7:1:-1', 42, null])
    // An unreadable citation still leaves a readable card — 「n7:1:nope」 and
    // 「n7:1:-1」 open the card with nothing open inside it. The rest name
    // nothing at all.
    expect([...out.notes]).toEqual(['7:1'])
    expect([...out.refs]).toEqual([])
    expect(out.cites).toEqual({})
  })

  it('has nothing to say for a missing or malformed value', () => {
    expect(plain(parseOpen(null))).toEqual({ notes: [], refs: [], cites: {} })
    expect(plain(parseOpen('n7:1'))).toEqual({ notes: [], refs: [], cites: {} })
  })
})

describe('serializeOpen', () => {
  it('round-trips', () => {
    const raw = ['n7:1:2', 'n7:2', 'r7:a:0']
    expect(serializeOpen(parseOpen(raw))).toEqual(raw)
  })

  it('leaves out a citation whose card is closed', () => {
    expect(serializeOpen(state(['7:1'], [], { 'n7:1': 2, 'n9:4': 1 }))).toEqual(['n7:1:2'])
  })

  it('keeps the two kinds apart when the ids would collide', () => {
    expect(serializeOpen(state(['7:1'], ['7:1'], { 'n7:1': 0 }))).toEqual(['n7:1:0', 'r7:1'])
  })
})
