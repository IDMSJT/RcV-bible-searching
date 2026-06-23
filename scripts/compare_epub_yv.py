#!/usr/bin/env python3
"""Compare every verse in `public/verse.json` (yv-derived) against the
EPUB-extracted text. Reports verses that differ — distinguishing pure
char-variant glyph differences (same length) from real content drift."""

from __future__ import annotations

import json
import re
import warnings
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings('ignore', category=XMLParsedAsHTMLWarning)

ROOT = Path(__file__).resolve().parent.parent
EPUB_TEXT = ROOT / 'scripts/sources/rcv_epub_extracted/OEBPS/Text'

BOOK_NO_TO_CODE = {
    1: 'Gen', 2: 'Exo', 3: 'Lev', 4: 'Num', 5: 'Deut',
    6: 'Josh', 7: 'Judg', 8: 'Ruth',
    9: '1Sam', 10: '2Sam', 11: '1Kgs', 12: '2Kgs',
    13: '1Chr', 14: '2Chr', 15: 'Ezra', 16: 'Neh', 17: 'Esth',
    18: 'Job', 19: 'Ps', 20: 'Prov', 21: 'Eccl', 22: 'Song',
    23: 'Isa', 24: 'Jer', 25: 'Lam', 26: 'Ezek', 27: 'Dan',
    28: 'Hos', 29: 'Joel', 30: 'Amos', 31: 'Obad', 32: 'Jonah',
    33: 'Mic', 34: 'Nah', 35: 'Hab', 36: 'Zeph', 37: 'Hag',
    38: 'Zech', 39: 'Mal',
    40: 'Matt', 41: 'Mark', 42: 'Luke', 43: 'John', 44: 'Acts',
    45: 'Rom', 46: '1Cor', 47: '2Cor', 48: 'Gal',
    49: 'Eph', 50: 'Phil', 51: 'Col',
    52: '1Thess', 53: '2Thess',
    54: '1Tim', 55: '2Tim', 56: 'Titus', 57: 'Philem',
    58: 'Heb', 59: 'James',
    60: '1Pet', 61: '2Pet',
    62: '1John', 63: '2John', 64: '3John',
    65: 'Jude', 66: 'Rev',
}


def parse_verse_text(p):
    """Extract verse plain text from a <p> in a B*.xhtml file. Same logic
    as the annotations extractor but only returns text (sup contents
    dropped, leading verse-marker anchor skipped)."""
    parts = []
    skipped_leading = False
    for child in p.children:
        name = getattr(child, 'name', None)
        if not skipped_leading and name in ('a', 'strong'):
            skipped_leading = True
            continue
        if name is None:
            parts.append(str(child))
        elif name == 'sup':
            continue
        else:
            parts.append(child.get_text())
    return ''.join(parts).strip()


def load_epub_book(book_no: int):
    """Return {chapter: {verse: text}} for one book by scanning all
    B<code>*.xhtml files that include a chapter heading."""
    code = BOOK_NO_TO_CODE[book_no]
    out = {}
    verse_id_re = re.compile(rf'^V(\d+){code}(\d+)$')
    for path in EPUB_TEXT.glob(f'B{code}*.xhtml'):
        soup = BeautifulSoup(path.read_text(encoding='utf-8'), 'lxml')
        for p in soup.find_all('p', id=verse_id_re):
            m = verse_id_re.match(p['id'])
            if not m:
                continue
            v = int(m.group(1))
            ch = int(m.group(2))
            text = parse_verse_text(p)
            out.setdefault(ch, {})[v] = text
    return out


def char_diff(a: str, b: str):
    """Return a list of (idx, char_a, char_b) for differing chars. Assumes
    equal length (otherwise truncates to the shorter)."""
    out = []
    for i, (ca, cb) in enumerate(zip(a, b)):
        if ca != cb:
            out.append((i, ca, cb))
    return out


def main():
    print('Loading verse.json…', flush=True)
    yv = json.loads((ROOT / 'public/verse.json').read_text(encoding='utf-8'))
    yv_books = {b['bookNo']: b for b in yv['books']}

    same_count = 0
    diff_glyph = 0       # same length, only char-variant glyph swaps
    diff_content = 0     # different length or non-trivial change
    missing_in_epub = 0
    glyph_pair_counter: Counter = Counter()
    diff_samples = []

    for book_no in sorted(BOOK_NO_TO_CODE):
        if book_no not in yv_books:
            continue
        epub_ch = load_epub_book(book_no)
        for ch in yv_books[book_no]['chapters']:
            chno = ch['chapterNo']
            for v in ch['verses']:
                vno = v['verse']
                if vno == 0:
                    continue
                yv_text = v['text']
                ep_text = epub_ch.get(chno, {}).get(vno)
                if ep_text is None:
                    missing_in_epub += 1
                    continue
                if yv_text == ep_text:
                    same_count += 1
                    continue
                if len(yv_text) == len(ep_text):
                    diff_glyph += 1
                    for ca, cb in zip(yv_text, ep_text):
                        if ca != cb:
                            glyph_pair_counter[(ca, cb)] += 1
                    if len(diff_samples) < 8:
                        diff_samples.append((book_no, chno, vno, 'glyph',
                                             yv_text, ep_text))
                else:
                    diff_content += 1
                    if len(diff_samples) < 8:
                        diff_samples.append((book_no, chno, vno, 'len',
                                             yv_text, ep_text))
        print(f'  {BOOK_NO_TO_CODE[book_no]} done', flush=True)

    total = same_count + diff_glyph + diff_content + missing_in_epub
    print()
    print(f'Total verses    : {total}')
    print(f'  identical     : {same_count}  ({100*same_count/total:.2f}%)')
    print(f'  glyph diff    : {diff_glyph}  ({100*diff_glyph/total:.2f}%)')
    print(f'  content diff  : {diff_content}  ({100*diff_content/total:.2f}%)')
    print(f'  missing epub  : {missing_in_epub}')
    print()
    print('Top glyph swap pairs (yv → epub):')
    for (a, b), n in glyph_pair_counter.most_common(10):
        print(f'  {a} → {b}: {n}')
    print()
    print('Sample diffs:')
    for book_no, ch, v, kind, ya, eb in diff_samples:
        print(f'  [{kind}] {BOOK_NO_TO_CODE[book_no]} {ch}:{v}')
        print(f'    yv  : {ya[:100]}')
        print(f'    epub: {eb[:100]}')


if __name__ == '__main__':
    main()
