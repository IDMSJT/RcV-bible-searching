import { describe, expect, it } from 'vitest'
import { prevRef, nextRef, type ReadingRef } from './readingRef'

const ch = (bookNo: number, chapterNo: number): ReadingRef => ({ kind: 'chapter', bookNo, chapterNo })
const ol = (bookNo: number): ReadingRef => ({ kind: 'outline', bookNo })

describe('readingRef — linear canon order', () => {
  it('outline → ch1 → ch2 forward', () => {
    expect(nextRef(ol(1))).toEqual(ch(1, 1))
    expect(nextRef(ch(1, 1))).toEqual(ch(1, 2))
  })

  it('ch1 back to its outline; ch2 back to ch1', () => {
    expect(prevRef(ch(1, 1))).toEqual(ol(1))
    expect(prevRef(ch(1, 2))).toEqual(ch(1, 1))
  })

  it('last chapter → next book outline; that outline back to the last chapter', () => {
    // Genesis has 50 chapters; book 2 is Exodus.
    expect(nextRef(ch(1, 50))).toEqual(ol(2))
    expect(prevRef(ol(2))).toEqual(ch(1, 50))
  })

  it('ends are null: Genesis outline has no prev, Revelation last chapter no next', () => {
    expect(prevRef(ol(1))).toBeNull()
    // Revelation is book 66 with 22 chapters.
    expect(nextRef(ch(66, 22))).toBeNull()
  })
})
