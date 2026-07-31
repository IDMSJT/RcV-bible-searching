#!/usr/bin/env python3
"""從 bibleread.online(LSM 官方線上恢復本)重建 `public/verse_en.json`。

先前的英文出自朋友那份中英對照 DB(見 build_verse_en.py),版次不明。全書逐節
比對(compare_verse_en_bibleread.py)顯示 27,996 節逐字相同,其餘差異裡有兩類
是實質的:術語修訂(judgments→ordinances、spoon→cup、brass→bronze)與我們這邊
的缺字(Selah 缺 15 處)。大小寫也證實我們這份並不可靠 —— 王上20:14 同一節裡
同一個說話者一次小寫一次大寫。所以整份改採官方版,只留下經人工判讀的例外。

例外(見 KEEP_OURS / SKIP_THEIRS):對方漏掉的節、指涉基督而應大寫的代名詞、
對方的錯字,以及對方放在 verse 0 但其實是卷別標題/字母標記的編排結構。

用法:
    cd scripts && .venv/bin/python compare_verse_en_bibleread.py   # 先抓齊快取
    cd scripts && .venv/bin/python build_verse_en_bibleread.py

輸出 scripts/output/verse_en.json —— 確認後才覆蓋 public/。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from compare_verse_en_bibleread import SLUGS, chapter_counts, fetch, norm, parse

HERE = Path(__file__).resolve().parent
CUR = HERE.parent / "public" / "verse_en.json"
ZH = HERE.parent / "public" / "verse.json"
OUT = HERE / "output" / "verse_en.json"

SOURCE = "Living Stream Ministry; bibleread.online (current edition)"

# 保留我們原本的字,對方那一節不採用。(bookNo, chapter, verse) → 為什麼
KEEP_OURS: dict[tuple[int, int, int], str] = {
    (23, 60, 18): "對方整節缺漏(節號直接從 17 跳到 19)",
    (38, 6, 12): "「苗」指基督,代名詞大寫;對方改小寫",
    (38, 6, 13): "同上",
    (10, 1, 16): "對方作 You’re,應為 Your(你流人血的罪歸到你自己頭上)",
}

# 對方有、我們沒有,但不該收:那是編排結構而非經文。
SKIP_THEIRS: set[tuple[int, int, int]] = {
    (19, 1, 0),    # Book One. Psalms 1—41 …(卷別分隔標題)
    (19, 107, 0),  # Book Five. Psalms 107—150 …
    (19, 119, 0),  # א (Aleph) —— 希伯來字母段落標記
}


def tidy_quotes(s: str) -> str:
    """把對方的排版引號收斂成我們既有的直式寫法。破折號不動 —— 那不是引號,
    而且對方的長破折號本來就比較正規。"""
    return s.replace("''", '"').replace("’", "'").replace("‘", "'")


def load(path: Path) -> dict[tuple[int, int, int], str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for bk in data["books"]:
        for ch in bk["chapters"]:
            for v in ch["verses"]:
                out[(bk["bookNo"], ch["chapterNo"], v["verse"])] = v["text"]
    return out


def main() -> int:
    counts = chapter_counts()
    ours = load(CUR)
    zh = json.loads(ZH.read_text(encoding="utf-8"))
    names = {b["bookNo"]: b["name"] for b in json.loads(CUR.read_text(encoding="utf-8"))["books"]}

    theirs: dict[tuple[int, int, int], str] = {}
    missing_pages: list[str] = []
    for b, n in enumerate(counts, start=1):
        for c in range(1, n + 1):
            _, html = fetch((b, c))
            if html is None:
                missing_pages.append(f"{b}:{c}")
                continue
            for v, t in parse(html).items():
                theirs[(b, c, v)] = tidy_quotes(norm(t))
    if missing_pages:
        print(f"✗ 這些章沒有快取,請先跑 compare_verse_en_bibleread.py:{missing_pages}", file=sys.stderr)
        return 1

    # 逐節挑選:預設用對方,例外用我們的;對方沒有的節保留我們的。
    stats = {"theirs": 0, "kept_ours": 0, "ours_only": 0, "added": 0, "skipped": 0}
    merged: dict[tuple[int, int, int], str] = {}
    for k in sorted(set(ours) | set(theirs)):
        if k in SKIP_THEIRS:
            stats["skipped"] += 1
            continue
        if k in KEEP_OURS and k in ours:
            merged[k] = ours[k]
            stats["kept_ours"] += 1
        elif k in theirs:
            merged[k] = theirs[k]
            stats["theirs"] += 1
            if k not in ours:
                stats["added"] += 1
        else:
            merged[k] = ours[k]
            stats["ours_only"] += 1

    # 沿用 verse.json 的書卷 / 章順序,英文才排得跟中文一致。
    books = []
    n_verses = 0
    for bk in zh["books"]:
        b = bk["bookNo"]
        chapters = []
        for ch in bk["chapters"]:
            c = ch["chapterNo"]
            verses = [
                {"verse": v, "text": merged[(b, c, v)]}
                for v in sorted({k[2] for k in merged if k[0] == b and k[1] == c})
            ]
            if verses:
                chapters.append({"chapterNo": c, "verses": verses})
                n_verses += len(verses)
        books.append({"bookNo": b, "name": names.get(b, ""), "chapters": chapters})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"name": "Recovery Version (English)", "lang": "en", "source": SOURCE, "books": books},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    changed = sum(1 for k, t in merged.items() if k in ours and ours[k] != t)
    print(f"寫出 {OUT}({OUT.stat().st_size / 1048576:.2f} MB)")
    print(f"  節數        {n_verses:,}(原 {len(ours):,})")
    print(f"  採用對方    {stats['theirs']:,}(其中新增 {stats['added']})")
    print(f"  保留我們的  {stats['kept_ours']}(例外清單)+ {stats['ours_only']}(對方無此節)")
    print(f"  不採用      {stats['skipped']}(編排結構)")
    print(f"  實際內容改變 {changed:,} 節")
    return 0


if __name__ == "__main__":
    sys.exit(main())
