"""Scrape the Recovery Version Bible (Chinese, traditional) from recoveryversion.com.tw.

Outputs scripts/output/verse.json with shape:

    {
      "name": "聖經恢復本",
      "lang": "zh-TW",
      "source": "https://recoveryversion.com.tw/Style0A/026/",
      "books": [
        {
          "bookNo": 1,
          "name": "創世記",
          "chapters": [
            {
              "chapterNo": 1,
              "verses": [
                { "verse": 1, "text": "..." },
                { "verse": 2, "text": "merged", "segments": ["seg1", "seg2"] }
              ]
            }
          ]
        }
      ]
    }

Usage:
    python scrape_recovery.py                 # full scrape
    python scrape_recovery.py --book 1        # single book
    python scrape_recovery.py --book 1 --chapter 1   # single chapter (dry-run friendly)
    python scrape_recovery.py --no-cache      # ignore cached HTML, refetch
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from tqdm import tqdm
from urllib3.util.retry import Retry

BASE_URL = "https://recoveryversion.com.tw/Style0A/026"
CHAPTER_URL_FMT = f"{BASE_URL}/read_List.php?f_BookNo={{book}}&f_ChapterNo={{chapter}}"
MENU_URL = f"{BASE_URL}/memu.js"

SCRIPT_DIR = Path(__file__).parent
CACHE_DIR = SCRIPT_DIR / "cache"
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_FILE = OUTPUT_DIR / "verse.json"

REQUEST_DELAY = 0.4  # seconds between requests
USER_AGENT = "open-verse-scraper/0.1 (study tool; contact: github.com/guanboo-yang/open-verse)"


def _make_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=8,
        connect=5,
        read=5,
        status=5,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=4)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update({"User-Agent": USER_AGENT, "Connection": "keep-alive"})
    return s


SESSION = _make_session()

# Book names (zh-TW) keyed by bookNo 1..66.
# Order matches the site's dropdown and standard Chinese Bible canon order.
BOOK_NAMES = [
    "創世記", "出埃及記", "利未記", "民數記", "申命記",
    "約書亞記", "士師記", "路得記", "撒母耳記上", "撒母耳記下",
    "列王紀上", "列王紀下", "歷代志上", "歷代志下", "以斯拉記",
    "尼希米記", "以斯帖記", "約伯記", "詩篇", "箴言",
    "傳道書", "雅歌", "以賽亞書", "耶利米書", "耶利米哀歌",
    "以西結書", "但以理書", "何西阿書", "約珥書", "阿摩司書",
    "俄巴底亞書", "約拿書", "彌迦書", "那鴻書", "哈巴谷書",
    "西番雅書", "哈該書", "撒迦利亞書", "瑪拉基書",
    "馬太福音", "馬可福音", "路加福音", "約翰福音", "使徒行傳",
    "羅馬書", "哥林多前書", "哥林多後書", "加拉太書", "以弗所書",
    "腓立比書", "歌羅西書", "帖撒羅尼迦前書", "帖撒羅尼迦後書",
    "提摩太前書", "提摩太後書", "提多書", "腓利門書", "希伯來書",
    "雅各書", "彼得前書", "彼得後書",
    "約翰一書", "約翰二書", "約翰三書", "猶大書", "啟示錄",
]


def fetch_menu() -> list[list[int]]:
    """Fetch memu.js and parse BookMaxArray.

    Returns a list of 66 lists. result[i] = [chapter_count, verses_in_ch1, verses_in_ch2, ...].
    """
    cache_path = CACHE_DIR / "memu.js"
    if cache_path.exists():
        text = cache_path.read_text(encoding="utf-8")
    else:
        resp = _fetch_with_retry(MENU_URL)
        text = resp.text
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(text, encoding="utf-8")

    pattern = re.compile(r'BookMaxArray\[(\d+)\]\s*=\s*"([\d,]+)"')
    rows: dict[int, list[int]] = {}
    for m in pattern.finditer(text):
        idx = int(m.group(1))
        rows[idx] = [int(x) for x in m.group(2).split(",")]
    if len(rows) != 66:
        raise RuntimeError(f"Expected 66 books in memu.js, got {len(rows)}")
    return [rows[i] for i in range(66)]


def _fetch_with_retry(url: str, attempts: int = 6) -> requests.Response:
    """GET with extra application-level retries on top of the session's HTTPAdapter
    retries, for cases where the server resets the connection mid-response."""
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            resp = SESSION.get(url, timeout=30)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            wait = min(60, 2 ** i)
            time.sleep(wait)
    assert last_exc is not None
    raise last_exc


def fetch_chapter_html(book_no: int, chapter_no: int, use_cache: bool = True) -> str:
    cache_path = CACHE_DIR / f"{book_no:02d}_{chapter_no:03d}.html"
    if use_cache and cache_path.exists():
        return cache_path.read_text(encoding="utf-8")
    url = CHAPTER_URL_FMT.format(book=book_no, chapter=chapter_no)
    resp = _fetch_with_retry(url)
    resp.encoding = "utf-8"  # page declares utf-8 in <meta>
    html = resp.text
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(html, encoding="utf-8")
    time.sleep(REQUEST_DELAY)
    return html


# A verse row looks like:
#   <TR><TD WIDTH=50 VALIGN=TOP >1:<A NAME="2">2</A></TD><TD COLSPAN=6>...</TD></TR>
# We anchor on the <A NAME="N">N</A> in a TD whose text starts with "C:" (chapter colon).
VERSE_LABEL_RE = re.compile(r"^\s*(\d+)\s*:\s*(\d+)\s*$")


NOTE_URL_RE = re.compile(r"FunShow\d+\.php\?B=\d+_\d+_(\d+)_(\d+)_(\d+)")


def _extract_segment(body_td) -> tuple[str, list[tuple[int, int]]]:
    """Walk a verse body TD and return (clean_text, [(note_n, pos), ...]).

    `pos` is the unicode character index in clean_text where the marker sits
    (just before the next character of text).
    """
    text_parts: list[str] = []
    char_count = 0
    notes: list[tuple[int, int]] = []

    def walk(node):
        nonlocal char_count
        if getattr(node, "name", None):
            tag = node.name.lower()
            if tag == "a" and "notes" in (node.get("class") or []):
                href = node.get("href", "")
                m = NOTE_URL_RE.search(href)
                if m:
                    note_n = int(m.group(3))
                    notes.append((note_n, char_count))
                return  # skip rendering the <sup>N</sup> inside
            if tag == "sup":
                return  # stray sup
            for child in node.children:
                walk(child)
            return
        s = str(node)
        s = re.sub(r"[\s　]+", "", s)
        if s:
            text_parts.append(s)
            char_count += len(s)

    for child in body_td.children:
        walk(child)

    return "".join(text_parts), notes


def parse_chapter(html: str, expected_chapter: int) -> list[dict]:
    """Return list of verse dicts in source order.

    Each verse dict has:
        verse: int
        text: str                     # merged
        segments?: [str]              # only when split across outline rows
        notes?: [{n: int, pos: int}]  # only when annotations exist; pos is
                                      # the character offset in `text`
    """
    soup = BeautifulSoup(html, "lxml")

    segments_by_verse: dict[int, list[str]] = {}
    notes_by_verse: dict[int, list[tuple[int, int]]] = {}
    verse_order: list[int] = []

    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 2:
            continue
        label_td = tds[0]
        anchor = label_td.find("a", attrs={"name": True})
        if not anchor:
            continue
        label_text = label_td.get_text(strip=True)
        m = VERSE_LABEL_RE.match(label_text)
        if not m:
            continue
        ch_num = int(m.group(1))
        verse_num = int(m.group(2))
        if ch_num != expected_chapter:
            continue

        body_td = tds[1]
        seg_text, seg_notes = _extract_segment(body_td)
        if not seg_text:
            continue

        if verse_num not in segments_by_verse:
            segments_by_verse[verse_num] = []
            notes_by_verse[verse_num] = []
            verse_order.append(verse_num)

        # Offset note positions by accumulated text length from prior segments.
        prior_len = sum(len(s) for s in segments_by_verse[verse_num])
        for n, pos in seg_notes:
            notes_by_verse[verse_num].append((n, prior_len + pos))
        segments_by_verse[verse_num].append(seg_text)

    out: list[dict] = []
    for vn in verse_order:
        segs = segments_by_verse[vn]
        merged = "".join(segs)
        entry: dict = {"verse": vn, "text": merged}
        if len(segs) > 1:
            entry["segments"] = segs
        notes = notes_by_verse[vn]
        if notes:
            entry["notes"] = [{"n": n, "pos": p} for n, p in notes]
        out.append(entry)
    out.sort(key=lambda v: v["verse"])
    return out


def scrape(book_filter: int | None = None, chapter_filter: int | None = None, use_cache: bool = True) -> dict:
    menu = fetch_menu()

    books_out: list[dict] = []

    book_range = [book_filter] if book_filter else list(range(1, 67))
    for book_no in book_range:
        if book_no < 1 or book_no > 66:
            raise ValueError(f"book_no out of range: {book_no}")
        row = menu[book_no - 1]
        chapter_count = row[0]
        verse_counts = row[1:]
        if len(verse_counts) != chapter_count:
            raise RuntimeError(
                f"Book {book_no}: chapter_count={chapter_count} but got {len(verse_counts)} verse-count entries"
            )

        ch_range = [chapter_filter] if chapter_filter else list(range(1, chapter_count + 1))

        book_entry = {
            "bookNo": book_no,
            "name": BOOK_NAMES[book_no - 1],
            "chapters": [],
        }

        bar = tqdm(ch_range, desc=f"{book_no:02d} {BOOK_NAMES[book_no - 1]}", unit="ch", leave=False)
        for chapter_no in bar:
            html = fetch_chapter_html(book_no, chapter_no, use_cache=use_cache)
            verses = parse_chapter(html, chapter_no)

            # Validation: count of distinct verse numbers should match memu.js.
            # Note: Psalms include a "verse 0" (superscription) which the site
            # counts as part of the verse count, so this works out.
            expected_verses = verse_counts[chapter_no - 1]
            actual_verses = len(verses)
            if actual_verses != expected_verses:
                bar.write(
                    f"  ! mismatch {BOOK_NAMES[book_no - 1]} {chapter_no}: "
                    f"expected {expected_verses}, got {actual_verses}"
                )

            book_entry["chapters"].append(
                {"chapterNo": chapter_no, "verses": verses}
            )

        books_out.append(book_entry)

    return {
        "name": "聖經恢復本",
        "lang": "zh-TW",
        "source": BASE_URL + "/",
        "books": books_out,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int, help="single book number (1-66)")
    ap.add_argument("--chapter", type=int, help="single chapter number (with --book)")
    ap.add_argument("--no-cache", action="store_true", help="ignore cached HTML; refetch all")
    ap.add_argument("--out", type=Path, default=OUTPUT_FILE, help="output JSON path")
    ap.add_argument("--pretty", action="store_true", help="pretty-print JSON (larger file)")
    args = ap.parse_args()

    if args.chapter and not args.book:
        ap.error("--chapter requires --book")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    data = scrape(
        book_filter=args.book,
        chapter_filter=args.chapter,
        use_cache=not args.no_cache,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.pretty:
        args.out.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    else:
        args.out.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    size_kb = args.out.stat().st_size / 1024
    n_books = len(data["books"])
    n_chapters = sum(len(b["chapters"]) for b in data["books"])
    n_verses = sum(len(c["verses"]) for b in data["books"] for c in b["chapters"])
    print(f"Wrote {args.out} ({size_kb:.1f} KB): {n_books} books, {n_chapters} chapters, {n_verses} verses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
