#!/usr/bin/env python3
"""Extract RcV annotations (註釋) from the EPUB for a given book/chapter.

Reads `scripts/sources/rcv_epub_extracted/OEBPS/Text/B<BookCode>...` for the
chapter content (only to walk the verse → note-file mapping) and pulls each
verse's footnote paragraphs out of the corresponding `N<...>.xhtml` files.

The note text is stored as a plain string — embedded cross-references like
「啟二二21」 stay as inline labels and are parsed at render time by the
existing parseRefs in the React app (no need to duplicate them as a
structured `refs[]` field).

Usage: python3 scripts/extract_annotations.py 40 1
       (bookNo=40 Matthew, chapter=1)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Optional

import warnings

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

# These xhtml files declare an XML prolog so bs4 nags about using the html
# parser; the html parser is intentional here (XML parser is stricter than the
# Calibre-generated markup tolerates), so silence the noise.
warnings.filterwarnings('ignore', category=XMLParsedAsHTMLWarning)

ROOT = Path(__file__).resolve().parent.parent
EPUB_TEXT = ROOT / 'scripts/sources/rcv_epub_extracted/OEBPS/Text'

# Map our 1..66 bookNo back to the EPUB book code for B/N file lookups.
BOOK_NO_TO_CODE = {
    1: 'Gen', 2: 'Exod', 3: 'Lev', 4: 'Num', 5: 'Deut',
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
    54: '1Tim', 55: '2Tim', 56: 'Titus', 57: 'Phlm',
    58: 'Heb', 59: 'Jas',
    60: '1Pet', 61: '2Pet',
    62: '1John', 63: '2John', 64: '3John',
    65: 'Jude', 66: 'Rev',
}
def find_chapter_file(book_code: str, chapter_no: int) -> Optional[Path]:
    """Find the xhtml that actually contains the verses for this chapter.
    EPUB splits books across multiple files; the chapter heading lives in
    one of `B<code>*.xhtml`. We grep for `id="C<chapter><code>"`.
    """
    needle = f'id="C{chapter_no}{book_code}"'
    for path in EPUB_TEXT.glob(f'B{book_code}*.xhtml'):
        try:
            text = path.read_text(encoding='utf-8')
        except OSError:
            continue
        if needle in text:
            return path
    return None


def extract_notes_from_file(note_file: Path):
    """Walk every `<p class="note">` in the note file and pull out
    `{n, text}` entries. EPUB groups all notes for one verse in one file,
    so we just return them in document order. Anchor links are flattened
    to their visible text — the app's ref parser can pick those up at
    render time."""
    soup = BeautifulSoup(note_file.read_text(encoding='utf-8'), 'lxml')
    notes = []
    for p in soup.find_all('p', class_='note'):
        strong = p.find('strong')
        if not strong or not strong.get_text(strip=True):
            continue
        m = re.match(r'(\d+)\.', strong.get_text(strip=True))
        if not m:
            continue
        n = int(m.group(1))

        # Drop the leading "N." marker — we surface it as the structured
        # `n` field. get_text('') concatenates text nodes without inserting
        # spaces around inline <a> elements (which would otherwise leave
        # gaps in the middle of 「（ 林前五6 ）」).
        strong.extract()
        text = p.get_text('', strip=True)
        text = re.sub(r'^\d+\.\s*', '', text)
        # Calibre flattened paragraph breaks in the source EPUB to single
        # ASCII spaces. Chinese text never has a real space after 句末標點,
        # so re-promote those to newlines for the renderer to honour.
        text = re.sub(r'([。？！]) +', r'\1\n', text)
        notes.append({'n': n, 'text': text})
    return notes


def parse_verse_markers(p):
    """Walk a verse <p>'s children and return a list of {n, offset} marker
    positions. Offsets are measured against the verse text with leading
    whitespace trimmed — same convention as `verse.json`, so we don't need
    to ship the EPUB's verse text alongside (yv-derived `verse.json` differs
    only in a few character-variant glyphs and stays char-count compatible).
    """
    markers = []
    offset = 0
    skipped_leading = False
    raw_len = 0  # to compute leading whitespace once we have the full text
    pieces = []
    for child in p.children:
        name = getattr(child, 'name', None)
        if not skipped_leading and name in ('a', 'strong'):
            skipped_leading = True
            continue
        if name is None:  # NavigableString
            s = str(child)
            pieces.append(s)
            offset += len(s)
        elif name == 'sup':
            try:
                n = int(child.get_text(strip=True))
                markers.append({'n': n, 'offset': offset})
            except ValueError:
                pass
        else:
            s = child.get_text()
            pieces.append(s)
            offset += len(s)
    raw = ''.join(pieces)
    raw_len = len(raw)
    # Strip whitespace at both ends; markers are already in raw-text
    # coordinates, so shift left by however much we stripped from the front.
    skip = raw_len - len(raw.lstrip())
    return [{'n': m['n'], 'offset': max(0, m['offset'] - skip)} for m in markers]


def extract_chapter(book_no: int, chapter_no: int):
    book_code = BOOK_NO_TO_CODE[book_no]
    chapter_file = find_chapter_file(book_code, chapter_no)
    if not chapter_file:
        raise SystemExit(f'cannot find chapter file for {book_code} {chapter_no}')

    soup = BeautifulSoup(chapter_file.read_text(encoding='utf-8'), 'lxml')
    verses = []
    verse_id_re = re.compile(rf'^V(\d+){book_code}{chapter_no}$')
    for p in soup.find_all('p', id=verse_id_re):
        m = verse_id_re.match(p.get('id', ''))
        if not m:
            continue
        verse_no = int(m.group(1))
        markers = parse_verse_markers(p)

        # The note file is linked via the verse's leading <a href>. If a
        # verse has no notes, the link is replaced by a <strong>.
        a = p.find('a', href=True)
        note_bodies = []
        if a:
            href = a['href']
            file_part = href.split('#', 1)[0]
            note_file = (chapter_file.parent / file_part).resolve()
            if note_file.exists():
                note_bodies = extract_notes_from_file(note_file)

        # Merge marker offsets and note bodies into a single list keyed by
        # `n` — same index in both arrays by construction, but we pair on
        # `n` so an out-of-order or missing entry doesn't desync.
        marker_by_n = {m['n']: m['offset'] for m in markers}
        notes = []
        for body in note_bodies:
            offset = marker_by_n.get(body['n'])
            if offset is None:
                continue  # note without an in-text marker — drop it
            notes.append({'n': body['n'], 'offset': offset, 'text': body['text']})

        if notes:
            verses.append({'verse': verse_no, 'notes': notes})

    return {'bookNo': book_no, 'chapter': chapter_no, 'verses': verses}


def main():
    if len(sys.argv) != 3:
        print('usage: extract_annotations.py <bookNo> <chapter>', file=sys.stderr)
        sys.exit(1)
    book_no = int(sys.argv[1])
    chapter = int(sys.argv[2])
    result = extract_chapter(book_no, chapter)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
