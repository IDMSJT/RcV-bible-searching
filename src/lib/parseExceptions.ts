/**
 * Places the parser has to be told about one at a time.
 *
 * An exception says how to *read* a passage, never what the passage says. The
 * alternative — writing the missing book name into the note and shipping that —
 * would put words on the page that the printed edition doesn't have, and would
 * leave every offset into that text a character out of step. So the text stays
 * as published and the correction lives here.
 *
 * Keyed on the phrase rather than on a position, because a phrase survives the
 * text being rebuilt from the source and an offset does not. Each `find` is
 * unique in the corpus (asserted in the tests).
 *
 * Adding to this list is a defeat, so the reasons are in
 * scripts/PARSE_EXCEPTIONS.md — including the measurements behind the rules
 * that were tried instead and rejected. Read it before adding a third.
 */
export interface ContextSeed {
  /** The phrase this applies to. The context is set at its start. */
  find: string
  /** What a bare number inside the phrase should be read against. */
  book: number
  chapter: number
  /** Where it appears, and how we know. */
  why: string
}

export const CONTEXT_SEEDS: ContextSeed[] = [
  {
    // 「主的晚餐」 is Luke 22:19-20 — 「又拿起餅來…這是我的身體」. Mark 14:19-20 is
    // 「他們就憂愁起來，一個一個的問祂說，是我麼？」, which is not the supper.
    find: '因主的晚餐是在前面19～20節',
    book: 42,
    chapter: 22,
    why: '可十四20註1 — 前一個引經是路二二21～23，「前面」指的是那裡',
  },
  {
    // 「神在舊約並新約所差來的」 answers 2 Chr 24:19, 「但神仍遣申言者到他們那裏」.
    // Luke 11:19 is about casting out demons by Beelzebul.
    find: '而擴大前文19節',
    book: 14,
    chapter: 24,
    why: '路十一49註1 — 前一個引經是代下二四20～22，「前文」指的是那裡',
  },
]
