"""Scrape the Recovery Version Bible verse text from line.twgbr.org (newer edition).

The site serves one HTML page per book (01.html .. 66.html). Chapters are marked
by <h3 id="C{n}…">, verses by <sup>N</sup> inside the verse paragraphs. Notes:
  - The <h3> id is ambiguous (C11Sam = C1 + 1Sam), so the chapter number is read
    from the <h3> TEXT ("… 第 N 章/篇"); a book with no such text is single-chapter.
  - <sup> may carry a verse number ("3", "3上", "3下" → verse 3) or, when
    non-numeric, a 詩篇 superscription (verse 0).
  - Verses are wrapped inconsistently (sometimes <p class="calibre2">, sometimes a
    bare <p>) and may span a <p> boundary, so the verse number is carried across
    paragraphs and leading text continues the previous verse.

This edition does not split verses into segments. Output (one merged text per
verse) is written to scripts/output/verse_new.json.

Usage:
    python scrape_verse_twgbr.py            # all 66 books
    python scrape_verse_twgbr.py --book 1   # single book
    python scrape_verse_twgbr.py --no-cache # refetch
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

from scrape_verse_recoveryversion import BOOK_NAMES

BASE_URL = "https://line.twgbr.org/recoveryversion/bible/{book:02d}.html"
SCRIPT_DIR = Path(__file__).parent
CACHE_DIR = SCRIPT_DIR / "cache_new"
OUTPUT_FILE = SCRIPT_DIR / "output" / "verse_new.json"
DELAY = 0.4
UA = "open-verse-scraper/0.1 (study tool; github.com/guanboo-yang/open-verse)"

CHAPTER_TEXT_RE = re.compile(r"第\s*(\d+)\s*[章篇]")


def norm(s: str) -> str:
    """Collapse whitespace (verse text comparison is whitespace-insensitive)."""
    return re.sub(r"\s+", "", s)


def fetch_book(book_no: int, use_cache: bool = True) -> str:
    cache = CACHE_DIR / f"{book_no:02d}.html"
    if use_cache and cache.exists():
        return cache.read_text(encoding="utf-8")
    resp = requests.get(BASE_URL.format(book=book_no), headers={"User-Agent": UA}, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(resp.text, encoding="utf-8")
    time.sleep(DELAY)
    return resp.text


def parse_book(html: str) -> dict[int, dict[int, str]]:
    """Return {chapter: {verse: merged_text}} for one book page."""
    soup = BeautifulSoup(html, "lxml")
    chapters: dict[int, dict[int, str]] = {}
    cur_ch: int | None = None
    cur_verse: int | None = None
    buf: list[str] = []

    def flush():
        if cur_ch is not None and cur_verse is not None and cur_verse >= 0:
            txt = "".join(buf).strip()
            if txt:
                chapters[cur_ch][cur_verse] = chapters[cur_ch].get(cur_verse, "") + txt

    for el in soup.find_all(["h3", "p"]):
        if el.name == "h3":
            if not el.get("id", "").startswith("C"):
                continue
            flush()
            buf = []
            cur_verse = None
            m = CHAPTER_TEXT_RE.search(el.get_text())
            cur_ch = int(m.group(1)) if m else 1
            chapters.setdefault(cur_ch, {})
        elif el.name == "p" and cur_ch is not None and el.find("sup") is not None:
            for node in el.descendants:
                if isinstance(node, Tag) and node.name == "sup":
                    flush()
                    buf = []
                    t = node.get_text().strip()
                    mnum = re.match(r"(\d+)", t)
                    if mnum:
                        cur_verse = int(mnum.group(1))  # "3", "3上", "3下" → 3
                    else:
                        cur_verse = 0  # superscription (詩篇 title)
                        buf = [t]
                elif isinstance(node, NavigableString):
                    if node.parent is not None and node.parent.name == "sup":
                        continue
                    buf.append(str(node))
    flush()
    return chapters


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int, help="single book (1-66)")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out", type=Path, default=OUTPUT_FILE)
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    book_range = [args.book] if args.book else list(range(1, 67))

    books = []
    for book_no in book_range:
        ch_map = parse_book(fetch_book(book_no, use_cache=not args.no_cache))
        chapters = [
            {"chapterNo": ch, "verses": [{"verse": v, "text": ch_map[ch][v]}
                                         for v in sorted(ch_map[ch])]}
            for ch in sorted(ch_map)
        ]
        books.append({"bookNo": book_no, "name": BOOK_NAMES[book_no - 1], "chapters": chapters})

    data = {"name": "聖經恢復本", "lang": "zh-TW",
            "source": "https://line.twgbr.org/recoveryversion/", "books": books}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(data, ensure_ascii=False, indent=2 if args.pretty else None,
                   separators=None if args.pretty else (",", ":")),
        encoding="utf-8",
    )
    n = sum(len(c["verses"]) for b in books for c in b["chapters"])
    print(f"Wrote {args.out}: {len(books)} books, {n} verses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
