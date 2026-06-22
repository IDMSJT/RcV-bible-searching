/** English abbreviations for the 66 Bible books, keyed by bookNo (1-66).
 * Mirrors the form used in Recovery Version English citations (e.g. "Matt").
 */
export const BOOK_ABBREV_EN: Record<number, string> = {
  1: 'Gen', 2: 'Exo', 3: 'Lev', 4: 'Num', 5: 'Deut',
  6: 'Josh', 7: 'Judg', 8: 'Ruth',
  9: '1 Sam', 10: '2 Sam', 11: '1 Kings', 12: '2 Kings',
  13: '1 Chron', 14: '2 Chron',
  15: 'Ezra', 16: 'Neh', 17: 'Esth', 18: 'Job',
  19: 'Psa', 20: 'Prov', 21: 'Eccl', 22: 'S.S.',
  23: 'Isa', 24: 'Jer', 25: 'Lam', 26: 'Ezek', 27: 'Dan',
  28: 'Hos', 29: 'Joel', 30: 'Amos', 31: 'Obad', 32: 'Jonah',
  33: 'Mic', 34: 'Nah', 35: 'Hab', 36: 'Zeph', 37: 'Hag',
  38: 'Zech', 39: 'Mal',
  40: 'Matt', 41: 'Mark', 42: 'Luke', 43: 'John', 44: 'Acts',
  45: 'Rom', 46: '1 Cor', 47: '2 Cor', 48: 'Gal',
  49: 'Eph', 50: 'Phil', 51: 'Col',
  52: '1 Thes', 53: '2 Thes',
  54: '1 Tim', 55: '2 Tim', 56: 'Titus', 57: 'Philem',
  58: 'Heb', 59: 'James',
  60: '1 Pet', 61: '2 Pet',
  62: '1 John', 63: '2 John', 64: '3 John',
  65: 'Jude', 66: 'Rev',
}
