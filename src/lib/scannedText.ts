import { BOOK_ALIAS_RE } from '@/data/bookAliases'
import { normalizeRefText, parseRefs, type VerseRef } from '@/lib/parseRefs'

/**
 * Tidying text that came off a page rather than a keyboard.
 *
 * Reading a photograph — the phone's own text recognition, or ours — gets the
 * characters right and the layout approximately. Two of its habits stop a
 * citation from parsing, and neither is something the parser should learn:
 *
 *   - a space dropped inside a reference, so 「羅十13」 arrives as 「羅十 13」
 *   - a line ending mid-citation, because the printed line ran out:
 *     「…徒二24，腓三10～」 / 「11」
 *
 * Both are artefacts of the page, so they are undone here, where the page's
 * text arrives, and not in parseRefs, which reads what people write.
 *
 * Measured over six photographs of training outlines, against the citations
 * read off them by eye: the reading line went from 90% to 94% recognised.
 *
 * Only applied to text that spans several lines. A single line is somebody
 * typing or pasting one reference, and there the spaces are theirs — the
 * keyword search separates its words with them.
 */
export function tidyScanned(text: string): string {
  if (!text.includes('\n')) return text
  return (
    text
      // A space between two numbers is never meant: 「羅十 13」, 「詩十八 6」.
      .replace(/([0-9０-９一二三四五六七八九十百千○〇])[ \u3000]+(?=[0-9０-９一二三四五六七八九十百千○〇])/g, '$1')
      // A line that stops on a range mark or a separator hasn't finished.
      .replace(/([～~—－,，、])[ \u3000]*\n[ \u3000]*/g, '$1')
  )
}

/** Whether `inner` names nothing `outer` doesn't already reach. Chapter and
 * verse compare as a pair, so a span that crosses chapters still contains what
 * falls inside it. A citation carrying a note is never covered: 「徒二21註2」 is
 * a different place to be sent than 徒2:21. */
function covers(outer: VerseRef, inner: VerseRef): boolean {
  if (outer.bookNo !== inner.bookNo) return false
  if (inner.note != null || inner.noteAll) return outer.note === inner.note && !!outer.noteAll === !!inner.noteAll
  const from = (c: number, v: number) => c * 1000 + v
  return (
    from(outer.chapter, outer.verseStart) <= from(inner.chapter, inner.verseStart) &&
    from(outer.endChapter, outer.verseEnd) >= from(inner.endChapter, inner.verseEnd)
  )
}

/**
 * Just the citations from a page of text, in the order they were printed.
 *
 * A photographed page is mostly prose, and putting all of it in the search box
 * buries the handful of references the reader wants. It is also repetitive: the
 * reading line at the top names a span, and the verses printed below it repeat
 * that span one number at a time.
 *
 * So a citation is dropped when an earlier one already reaches it. That reads
 * off the text rather than off the layout, which is what makes it safe — the
 * word 「讀經」 can be missing from a handout, or misread, and this does not
 * depend on finding it. What it keeps is the reading line plus anything further
 * down that genuinely points somewhere new.
 *
 * A citation naming no book only counts where it is still part of the list it
 * belongs to — 「啟一1～2，5，9～12，七9～17」 is four of them, and each borrows the
 * book from the one before. Left on its own it is nearly always a number the
 * recogniser found in the prose and the parser then attached to whatever was
 * last named. Anything with a book on the front is kept wherever it appears.
 */
const SEPARATOR = /^[、，,；;和及與\s]*$/

export interface Citation {
  /** As it was printed. */
  text: string
  /** Where it points. Kept from the one parse of the whole page, because a
   * citation naming no book only means anything beside the one before it —
   * 「5」 read on its own is a number. */
  refs: VerseRef[]
}

export function citationsIn(text: string): Citation[] {
  const { segments } = parseRefs(text)
  const kept: VerseRef[] = []
  const out: Citation[] = []
  let at = 0
  let endOfLast = -1
  for (const seg of segments) {
    const start = at
    at += seg.text.length
    if (!seg.refs?.length) continue
    const adjacent = endOfLast >= 0 && SEPARATOR.test(text.slice(endOfLast, start))
    if (!BOOK_ALIAS_RE.test(normalizeRefText(seg.text)) && !adjacent) continue
    if (seg.refs.every((r) => kept.some((k) => covers(k, r)))) continue
    kept.push(...seg.refs)
    out.push({ text: seg.text.trim(), refs: seg.refs })
    endOfLast = at
  }
  return out
}

/** The same, as one line to put in the search box. */
export function citationsOnly(text: string): string {
  return citationsIn(text)
    .map((c) => c.text)
    .join('，')
}
