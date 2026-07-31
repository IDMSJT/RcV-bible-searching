#!/usr/bin/env python3
"""比對 bibleread.online(LSM 官方線上恢復本)的英文 vs 我們的 public/verse_en.json。

我們的英文出自朋友那份中英對照 DB(見 build_verse_en.py),年份不明;官方站是
現行版本。抽樣顯示兩者絕大多數逐字相同,少數差異分成兩種性質完全不同的類型:

  * 引號 / 標點形式 —— 例:對方用兩個單引號當右雙引號。換過去反而會引進非標準
    字元,不該一律採用。
  * 實際譯文修訂 —— 例:創1:29 的 yielding → that produces。這種才是換版本的理由。

所以本檔只做「比對與分類」,不動任何現役資料;要不要採用由報告決定。

頁面是伺服器端渲染的(`div.verse_text.jVerse[data-num]`),但需要瀏覽器 UA,
否則拿到的是不含經文的版本。

用法:
    cd scripts && .venv/bin/python compare_verse_en_bibleread.py

輸出:
    scripts/verse_en_bibleread_diff.json   完整差異(依類型分組)
    終端機:摘要
每章快取於 scripts/cache/bibleread/(gitignore);重跑只讀本機檔。
"""
from __future__ import annotations

import concurrent.futures
import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "bibleread"
CANON = HERE.parent / "src" / "data" / "canon.ts"
VERSE_EN = HERE.parent / "public" / "verse_en.json"
OUT = HERE / "verse_en_bibleread_diff.json"
URL = "https://bibleread.online/bible/{slug}/{chapter}/"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120 Safari/537.36"
)

# 站上的目錄是新約在前、舊約在後;這裡照我們 canon 的順序(創→啟)排好。
NT = [
    "the-gospel-according-to-matthew", "the-gospel-according-to-mark",
    "the-gospel-according-to-luke", "the-gospel-according-to-john",
    "the-acts-of-the-apostles", "the-epistle-of-paul-to-the-romans",
    "the-first-epistle-of-paul-to-the-corinthians",
    "the-second-epistle-of-paul-to-the-corinthians",
    "the-epistle-of-paul-to-the-galatians", "the-epistle-of-paul-to-the-ephesians",
    "the-epistle-of-paul-to-the-philippians", "the-epistle-of-paul-to-the-colossians",
    "the-first-epistle-of-paul-to-the-thessalonians",
    "the-second-epistle-of-paul-to-the-thessalonians",
    "the-first-epistle-of-paul-to-timothy", "the-second-epistle-of-paul-to-timothy",
    "the-epistle-of-paul-to-titus", "the-epistle-of-paul-to-philemon",
    "the-epistle-to-the-hebrews", "the-epistle-of-james",
    "the-first-epistle-of-peter", "the-second-epistle-of-peter",
    "the-first-epistle-of-john", "the-second-epistle-of-john",
    "the-third-epistle-of-john", "the-epistle-of-jude", "revelation",
]
OT = [
    "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua", "judges",
    "ruth", "first-samuel", "second-samuel", "first-kings", "second-kings",
    "first-chronicles", "second-chronicles", "ezra", "nehemiah", "esther", "job",
    "psalms", "proverbs", "ecclesiastes", "song-of-songs", "isaiah", "jeremiah",
    "lamentations", "ezekiel", "daniel", "hosea", "joel", "amos", "obadiah", "jonah",
    "micah", "nahum", "habakkuk", "zephaniah", "haggai", "zechariah", "malachi",
]
SLUGS = OT + NT  # bookNo 1..66

# 兩邊只差這些字元的,算「引號 / 標點形式」而非改譯。
QUOTES = "‘’“”'\"`´"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def chapter_counts() -> list[int]:
    txt = CANON.read_text(encoding="utf-8")
    return [int(m.group(1)) for m in re.finditer(r"\[\s*'[^']*',\s*(\d+)\s*\]", txt)]


def fetch(bc: tuple[int, int]) -> tuple[tuple[int, int], str | None]:
    book, chap = bc
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{book:02d}.{chap:03d}.html"
    if f.exists() and f.stat().st_size > 1000:
        return bc, f.read_text(encoding="utf-8")
    url = URL.format(slug=SLUGS[book - 1], chapter=chap)
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                html = r.read().decode("utf-8", "replace")
            f.write_text(html, encoding="utf-8")
            return bc, html
        except Exception:  # noqa: BLE001 — 任何網路錯誤都重試
            continue
    log(f"  ✗ {book}:{chap} {url}")
    return bc, None


def parse(html: str) -> dict[int, str]:
    """{節: 英文}。移除註解上標與節次標籤;串接時不補空格 —— 詞間空白本來就在
    文字節點裡,補了會在被移除的標號處留下多餘空格。"""
    soup = BeautifulSoup(html, "html.parser")
    out: dict[int, str] = {}
    for d in soup.select("div.verse_text.jVerse"):
        frag = BeautifulSoup(str(d), "html.parser")
        for tag in frag.select("strong.verse_url, strong.verse_name, sup"):
            tag.decompose()
        text = re.sub(r"\s+", " ", frag.get_text("")).strip()
        num = d.get("data-num")
        if num and text:
            out[int(num)] = text
    return out


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def fold_quotes(s: str) -> str:
    """引號一律收斂成同一個字元,好把「只差引號」的差異挑出來。"""
    return "".join("\"" if c in QUOTES else c for c in s)


def classify(a: str, b: str) -> str:
    if fold_quotes(a) == fold_quotes(b):
        return "quotes"
    strip = lambda s: re.sub(r"[^\w\s]", "", fold_quotes(s))  # noqa: E731
    if strip(a) == strip(b):
        return "punct"
    if strip(a).lower() == strip(b).lower():
        return "case"
    return "wording"


def main() -> int:
    counts = chapter_counts()
    assert len(counts) == 66, f"canon 解析到 {len(counts)} 卷,應為 66"
    todo = [(b, c) for b, n in enumerate(counts, start=1) for c in range(1, n + 1)]
    log(f"共 {len(todo)} 章(已快取的會跳過)…")

    theirs: dict[tuple[int, int, int], str] = {}
    failed: list[str] = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for (b, c), html in ex.map(fetch, todo):
            done += 1
            if done % 100 == 0:
                log(f"  …{done}/{len(todo)}")
            if html is None:
                failed.append(f"{b}:{c}")
                continue
            for v, t in parse(html).items():
                theirs[(b, c, v)] = norm(t)

    ours_raw = json.loads(VERSE_EN.read_text(encoding="utf-8"))
    ours: dict[tuple[int, int, int], str] = {}
    for bk in ours_raw["books"]:
        for ch in bk["chapters"]:
            for ve in ch["verses"]:
                ours[(bk["bookNo"], ch["chapterNo"], ve["verse"])] = norm(ve["text"])

    same = 0
    groups: dict[str, list] = {"quotes": [], "punct": [], "case": [], "wording": []}
    only_ours, only_theirs = [], []
    ref = lambda k: f"{k[0]}:{k[1]}:{k[2]}"  # noqa: E731

    for k in sorted(set(ours) | set(theirs)):
        a, b = ours.get(k), theirs.get(k)
        if not b:
            only_ours.append(ref(k))
            continue
        if not a:
            only_theirs.append(ref(k))
            continue
        if a == b:
            same += 1
            continue
        groups[classify(a, b)].append({"ref": ref(k), "ours": a, "theirs": b})

    total = same + sum(len(v) for v in groups.values())
    OUT.write_text(
        json.dumps(
            {
                "_comment": "bibleread.online(官方)英文 vs public/verse_en.json 全書比對",
                "counts": {
                    "identical": same,
                    "quotes_only": len(groups["quotes"]),
                    "punct_only": len(groups["punct"]),
                    "case_only": len(groups["case"]),
                    "wording": len(groups["wording"]),
                    "only_ours": len(only_ours),
                    "only_theirs": len(only_theirs),
                    "fetch_failed": len(failed),
                },
                **groups,
                "only_ours": only_ours,
                "only_theirs": only_theirs,
                "fetch_failed": failed,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    log("─" * 52)
    log(f"兩邊都有的節   : {total:,}")
    log(f"  逐字相同     : {same:,}  ({100 * same / total:.2f}%)")
    log(f"  只差引號     : {len(groups['quotes']):,}")
    log(f"  只差標點     : {len(groups['punct']):,}")
    log(f"  只差大小寫   : {len(groups['case']):,}")
    log(f"  用字不同     : {len(groups['wording']):,}")
    log(f"只有我們有     : {len(only_ours)}")
    log(f"只有對方有     : {len(only_theirs)}")
    log(f"抓取失敗       : {len(failed)}")
    if groups["wording"]:
        log("\n用字差異最常見的替換:")
        pairs = Counter()
        for d in groups["wording"]:
            sm = __import__("difflib").SequenceMatcher(None, d["ours"].split(), d["theirs"].split())
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == "equal":
                    continue
                pairs[(" ".join(d["ours"].split()[i1:i2]), " ".join(d["theirs"].split()[j1:j2]))] += 1
        for (o, t), n in pairs.most_common(15):
            log(f"   {n:>4}×  「{o}」 → 「{t}」")
    log(f"\n詳見 {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
