#!/usr/bin/env python3
"""Run extract_annotations.extract_chapter for every chapter of every book in
a given range and merge the results into a single `public/annotations.json`.

Usage:
  python3 scripts/scrape_annotations.py nt    # NT only (books 40-66)
  python3 scripts/scrape_annotations.py ot    # OT only (books 1-39)
  python3 scripts/scrape_annotations.py all   # whole canon
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

from bs4 import XMLParsedAsHTMLWarning

warnings.filterwarnings('ignore', category=XMLParsedAsHTMLWarning)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_annotations import extract_chapter, BOOK_NO_TO_CODE

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / 'public/annotations.json'


def chapter_counts() -> dict[int, int]:
    """Pull chapter counts from the canonical data (verse.json) so we don't
    duplicate that table here."""
    bible = json.loads((ROOT / 'public/verse.json').read_text(encoding='utf-8'))
    return {b['bookNo']: len(b['chapters']) for b in bible['books']}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {'nt', 'ot', 'all'}:
        print('usage: scrape_annotations.py {nt|ot|all}', file=sys.stderr)
        sys.exit(1)

    scope = sys.argv[1]
    book_range: range
    if scope == 'nt':
        book_range = range(40, 67)
    elif scope == 'ot':
        book_range = range(1, 40)
    else:
        book_range = range(1, 67)

    counts = chapter_counts()
    books_out = []
    total_chapters = 0
    total_verses_with_notes = 0
    total_notes = 0

    for book_no in book_range:
        if book_no not in BOOK_NO_TO_CODE:
            continue
        chapters_total = counts.get(book_no, 0)
        chapters_out = []
        for chapter_no in range(1, chapters_total + 1):
            try:
                ch = extract_chapter(book_no, chapter_no)
            except SystemExit as e:
                print(f'  skip {BOOK_NO_TO_CODE[book_no]} {chapter_no}: {e}',
                      file=sys.stderr)
                continue
            verses = [v for v in ch['verses'] if v['notes']]
            if not verses:
                continue
            chapters_out.append({'chapterNo': chapter_no, 'verses': verses})
            total_chapters += 1
            total_verses_with_notes += len(verses)
            total_notes += sum(len(v['notes']) for v in verses)
        if chapters_out:
            books_out.append({'bookNo': book_no, 'chapters': chapters_out})
        print(f'  {BOOK_NO_TO_CODE[book_no]}: {chapters_total} chapters',
              flush=True)

    out = {'books': books_out}
    OUT_PATH.write_text(
        json.dumps(out, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8',
    )
    size = OUT_PATH.stat().st_size
    print()
    print(f'Wrote {OUT_PATH} — {size / 1024 / 1024:.1f} MB')
    print(f'  chapters: {total_chapters}')
    print(f'  verses with notes: {total_verses_with_notes}')
    print(f'  notes: {total_notes}')


if __name__ == '__main__':
    main()
