"""Scrape the Recovery Version (聖經恢復本) verse text from YouVersion / bible.com.

Source: bible.com version 4230 (恢復本), via its Next.js data endpoint:
    https://www.bible.com/_next/data/<buildId>/zh-TW/bible/4230/<BOOK>.<chapter>.json
The page itself is behind a bot challenge, but this JSON endpoint is not, so we
fetch it with plain HTTP (no headless browser). `chapterInfo.content` is the
chapter HTML with clean USFM classes:
    verse / data-usfm, label (節號 + 切段 2a/2b), content (本文),
    pn (人名), png (地名), add (譯者補字), tl (音譯), d (詩篇標題),
    s1–s4 (綱目), note/f/ft/fr/fqa (註釋 — skipped, this edition's notes are wrong).

Per-verse output: {"verse", "text", "segments"?, "marks"?} where marks are
offset spans [{"k":pn|png|add|tl, "s":start, "e":end}] into the clean text.
Notes and the 綱目 (s1–s4) are intentionally not emitted yet.

Cache: each chapter's content HTML → cache_yv/<USFM>.<ch>.html.
Output: scripts/output/verse_youversion.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import OrderedDict
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from scrape_verse_recoveryversion import BOOK_NAMES

SCRIPT_DIR = Path(__file__).parent
CACHE_DIR = SCRIPT_DIR / "cache_yv"
OUTPUT_FILE = SCRIPT_DIR / "output" / "verse_youversion.json"
VERSION_ID = 4230
HOME_URL = "https://www.bible.com/zh-TW"
DATA_URL = "https://www.bible.com/_next/data/{build}/zh-TW/bible/{vid}/{usfm}.{ch}.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")

# bookNo (1-66) → USFM book code
USFM = [
    "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA",
    "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
    "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO",
    "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
    "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH",
    "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS",
    "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
]

_SEG_LABEL_RE = re.compile(r"^(\d+)([a-z])$")  # 2a / 2b / 2c …
_MARK_KINDS = ("pn", "png", "add", "tl")  # person / place / supplied / transliteration


def get_build_id() -> str:
    r = requests.get(HOME_URL, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    m = re.search(r'"buildId":"([^"]+)"', r.text)
    if not m:
        raise RuntimeError("無法從首頁取得 buildId")
    return m.group(1)


def _in_note(node) -> bool:
    p = node.parent
    while p is not None:
        if "note" in (p.get("class") or []):
            return True
        p = p.parent
    return False


def _mark_kind(node) -> str | None:
    """Nearest wrapping span's semantic kind (pn/png/add/tl), if any."""
    anc = node.parent
    for _ in range(4):
        if anc is None:
            break
        cls = anc.get("class") or []
        for k in _MARK_KINDS:
            if k in cls:
                return k
        anc = anc.parent
    return None


def fetch_chapter(usfm: str, ch: int, build: str, use_cache: bool = True) -> str:
    cache = CACHE_DIR / f"{usfm}.{ch}.html"
    if use_cache and cache.exists() and cache.stat().st_size > 200:
        return cache.read_text(encoding="utf-8")
    url = DATA_URL.format(build=build, vid=VERSION_ID, usfm=usfm, ch=ch)
    last = None
    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": UA, "x-nextjs-data": "1"}, timeout=30)
            r.raise_for_status()
            html = r.json()["pageProps"]["chapterInfo"]["content"]
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(html, encoding="utf-8")
            return html
        except Exception as e:  # noqa: BLE001 - retry any transient failure
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fetch {usfm}.{ch} 失敗: {last}")


def _clean(s: str) -> str:
    return re.sub(r"\s+", "", s)


def parse_chapter(html: str, chapter: int) -> dict[int, dict]:
    """Return {verse: {"text", "segments"?, "marks"?}} for one chapter."""
    soup = BeautifulSoup(html, "lxml")
    root = soup.find(class_="chapter") or soup

    acc: "OrderedDict[int, dict]" = OrderedDict()

    def slot(vno: int) -> dict:
        return acc.setdefault(vno, {"text": "", "breaks": [], "marks": []})

    # Psalm descriptive title → verse 0
    d = root.find(class_="d")
    if d is not None:
        title = _clean("".join(
            c.get_text() for c in d.find_all(class_="content") if not _in_note(c)
        ))
        if title:
            slot(0)["text"] = title

    for vspan in root.find_all(class_="verse"):
        usfm = (vspan.get("data-usfm") or "").split(".")
        if len(usfm) != 3 or not usfm[2].isdigit() or int(usfm[1]) != chapter:
            continue
        s = slot(int(usfm[2]))
        nodes = vspan.find_all(
            lambda t: t.has_attr("class") and {"label", "content"} & set(t["class"])
        )
        for node in nodes:
            if _in_note(node):
                continue
            cls = node["class"]
            if "label" in cls:
                m = _SEG_LABEL_RE.match(node.get_text(strip=True))
                if m and m.group(2) != "a":  # 'b','c'… start a new segment
                    pos = len(s["text"])
                    if pos and (not s["breaks"] or s["breaks"][-1] != pos):
                        s["breaks"].append(pos)
            elif "content" in cls:
                t = _clean(node.get_text())
                if not t:
                    continue
                kind = _mark_kind(node)
                start = len(s["text"])
                s["text"] += t
                if kind:
                    s["marks"].append({"k": kind, "s": start, "e": len(s["text"])})

    out: dict[int, dict] = {}
    for vno, s in acc.items():
        text = s["text"]
        if not text:
            continue
        entry: dict = {"text": text}
        if s["breaks"]:
            bounds = [0, *s["breaks"], len(text)]
            segs = [text[a:b] for a, b in zip(bounds, bounds[1:]) if text[a:b]]
            if len(segs) > 1:
                entry["segments"] = segs
        if s["marks"]:
            entry["marks"] = s["marks"]
        out[vno] = entry
    return out


def main() -> int:
    from scrape_verse_recoveryversion import fetch_menu

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int, help="single book (1-66)")
    ap.add_argument("--max-book", type=int, default=66, help="scrape books 1..N")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out", type=Path, default=OUTPUT_FILE)
    args = ap.parse_args()

    build = get_build_id()
    print(f"buildId = {build}", file=sys.stderr)
    menu = fetch_menu()  # chapter counts per book
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    book_range = [args.book] if args.book else list(range(1, args.max_book + 1))

    books = []
    for book_no in book_range:
        chapter_count = menu[book_no - 1][0]
        usfm = USFM[book_no - 1]
        chapters = []
        for ch in range(1, chapter_count + 1):
            vmap = parse_chapter(fetch_chapter(usfm, ch, build, use_cache=not args.no_cache), ch)
            verses = [{"verse": v, **vmap[v]} for v in sorted(vmap)]
            chapters.append({"chapterNo": ch, "verses": verses})
            n_seg = sum(1 for e in verses if "segments" in e)
            n_mark = sum(len(e.get("marks", [])) for e in verses)
            print(f"  {usfm}.{ch}: {len(verses)} verses, {n_seg} 切段, {n_mark} 標記",
                  file=sys.stderr)
        books.append({"bookNo": book_no, "name": BOOK_NAMES[book_no - 1], "chapters": chapters})

    data = {"name": "聖經恢復本", "lang": "zh-TW",
            "source": "https://www.bible.com/zh-TW/bible/4230/ (YouVersion v4230)", "books": books}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(c["verses"]) for b in books for c in b["chapters"])
    print(f"Wrote {args.out}: {len(books)} books, {n} verses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
