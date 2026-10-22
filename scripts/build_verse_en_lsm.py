#!/usr/bin/env python3
"""從 LSM 官方的純文字版 https://text.recoveryversion.bible/ 產出 `public/verse_en.json`。

站上每章一個靜態 HTML(例 43_John_3.htm),經文在 `<section id="verses">` 裡的
`<p class="verse" id="Joh3-16">`;詩篇標題是 `<p class="text-outline" id="Psa3-0">`
(我們存成第 0 節)。詩體分行用 `<br />` 與 `<span class="acolon|bcolon"/>` 標示,
補字用 `<i>`。本檔只取純文字:分行併成一個空格、`<i>` 去掉,彎引號改直引號
(搜尋時使用者多半鍵入直引號)。

用法:
    cd scripts && python3 build_verse_en_lsm.py            # 抓齊(有快取)並寫入 public/verse_en.json
    cd scripts && python3 build_verse_en_lsm.py --check    # 只比對 public/ 與官網,不寫檔

每章快取於 scripts/cache/lsm_en/(gitignore);重抓請先刪該資料夾。
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "lsm_en"
OUT = HERE.parent / "public" / "verse_en.json"
BASE = "https://text.recoveryversion.bible/"
SOURCE = "text.recoveryversion.bible (Living Stream Ministry, Text Only Recovery Version)"

NAMES = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges",
    "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles",
    "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
    "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
    "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew",
    "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
    "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
    "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
    "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]
CHAPTERS = [
    50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31,
    12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
    28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def stems() -> list[str]:
    f = CACHE / "index.html"
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_bytes(get(BASE))
    found = re.findall(r'href="(\d\d_[A-Za-z0-9]+)_1\.htm"', f.read_text(encoding="utf-8"))
    assert len(found) == 66, len(found)
    return found


def get(url: str) -> bytes:
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            return urllib.request.urlopen(req, timeout=30).read()
        except Exception:
            time.sleep(1 + attempt)
    raise RuntimeError(f"fetch failed: {url}")


def chapter_html(stem: str, ch: int) -> str:
    f = CACHE / f"{stem}_{ch}.htm"
    if not f.exists():
        f.write_bytes(get(f"{BASE}{stem}_{ch}.htm"))
    return f.read_text(encoding="utf-8")


def clean(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"\s*/?<span class=\"[ab]colon\"\s*/>\s*", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ")
    s = s.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'}))
    return re.sub(r"\s+", " ", s).strip()


def parse(page: str) -> dict[int, str]:
    sec = page.split('<hr />', 2)[-1].split("</section>")[0]
    out: dict[int, str] = {}
    for pid, cls, body in re.findall(r'<p id="([^"]+)" class="([^"]*)">(.*?)</p>', sec, re.S):
        m = re.search(r"-(\d+)$", pid)
        if not m:
            continue
        if cls == "verse":
            out[int(m.group(1))] = clean(re.sub(r"^<b>.*?</b>", "", body, count=1, flags=re.S))
        elif cls == "text-outline" and m.group(1) == "0":
            out[0] = clean(body)
    return out


def build() -> dict:
    st = stems()
    jobs = [(i, c) for i in range(66) for c in range(1, CHAPTERS[i] + 1)]
    with ThreadPoolExecutor(3) as ex:
        pages = list(ex.map(lambda j: chapter_html(st[j[0]], j[1]), jobs))
    books = []
    for i in range(66):
        chapters = []
        for (bi, c), page in zip(jobs, pages):
            if bi != i:
                continue
            verses = parse(page)
            chapters.append({
                "chapterNo": c,
                "verses": [{"verse": v, "text": t} for v, t in sorted(verses.items()) if t],
            })
        books.append({"bookNo": i + 1, "name": NAMES[i], "chapters": chapters})
    return {"name": "Recovery Version (English)", "lang": "en", "source": SOURCE, "books": books}


def main() -> int:
    data = build()
    n = sum(len(c["verses"]) for b in data["books"] for c in b["chapters"])
    log(f"{n} verses (含詩篇標題)")
    if "--check" in sys.argv:
        cur = json.loads(OUT.read_text(encoding="utf-8"))
        same = cur["books"] == data["books"]
        log("public/verse_en.json 與官網" + ("相同" if same else "不同"))
        return 0 if same else 1
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    log(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
