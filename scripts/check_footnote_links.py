#!/usr/bin/env python3
"""🔍 檢查用 — 拿恢復本官網的引經標記,對照我們的解析。只印報告,不寫任何出貨檔。

站方在 `/api/getFootnoteLinks` 給出每則註解裡「哪一段是引經」的範圍。那是**編輯標
的**,不是算出來的——所以它切在哪裡,就是人判斷「這個引經從這裡重新開始」的地方,
正是我們的解析器只能猜的資訊。

它不是標準答案(已知至少兩處它自己也標錯,見 PARSE_EXCEPTIONS.md 第 2 節),但它錯
的地方和我們錯的地方**不一樣**,所以交集值得看。我們現有的兩把尺——「指向不存在
的經節」(客觀但只是下界)和「人工讀過每一筆改動」(完整但主觀)——都需要第三個意見。

刻意不出貨。匯入這些範圍的成本與收益已量過並記在 PARSE_EXCEPTIONS.md 末節;要重
估時先跑這支。

用法:
    cd scripts && .venv/bin/python check_footnote_links.py            # 每卷取 2 章
    cd scripts && .venv/bin/python check_footnote_links.py --all      # 全部 1189 章
    cd scripts && .venv/bin/python check_footnote_links.py 41:14 42:11

每章快取於 scripts/cache/rv_links/(gitignore);重跑只讀本機檔。
比對本身在 scripts/footnote_links.check.ts —— 解析器是 TypeScript,只能在那邊跑。
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / "cache" / "rv_links"
OUT = HERE / "output" / "footnote_cuts.json"
BASE = "https://www.recoveryversion.com.tw/api"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def chapter_counts() -> list[int]:
    txt = (ROOT / "src" / "data" / "canon.ts").read_text(encoding="utf-8")
    return [int(m.group(1)) for m in re.finditer(r"\[\s*'[^']*',\s*(\d+)\s*\]", txt)]


def api(name: str, book: int, chap: int) -> list[dict]:
    q = urllib.parse.urlencode(
        [("VERSION", 1), ("chapter_code", book), ("section_code", chap)]
    )
    req = urllib.request.Request(f"{BASE}/{name}?{q}", headers={"User-Agent": UA})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception:  # noqa: BLE001
            pass
    log(f"  ⚠ 取不到 {name} {book}:{chap}")
    return []


def fetch(job: tuple[int, int]) -> dict:
    book, chap = job
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{book:02d}.{chap:03d}.json"
    if f.exists() and f.stat().st_size > 0:
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    d = {
        "b": book,
        "c": chap,
        "notes": api("getFootnotes", book, chap),
        "links": api("getFootnoteLinks", book, chap),
    }
    f.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return d


def cuts_for(chapter: dict) -> list[dict]:
    """把區塊換算成「每則註自己的文字裡,哪些位置是新的引經區塊起點」。

    站方的 start_loc 是 1-based,切進「同一節的註依 note_num 串接、**並移除分段符
    ˍ (U+02CD)**」的那份文字。三層都要還原:

    1. 同一個 note_num 可有多列 —— 第一列帶內文,其餘只是額外的掛載位置。
    2. 分段符不計入他們的位置;我們存的是把它換成換行(等長),所以要補回來。
    3. 我們一則一則存,所以最後要從串接位置減去該則註的起點。

    (驗證:創1:1 四則註 29 個區塊,補上第 2 步之後全部切出引經;沒補之前從第 4 個
    起就整段偏掉。)
    """
    PARA = "\u02cd"
    out: list[dict] = []
    by_seg: dict[tuple[int, int], list[dict]] = {}
    for n in chapter["notes"]:
        by_seg.setdefault((n["segment_code"], n.get("unit_code", 0)), []).append(n)
    for (seg, unit), rows in by_seg.items():
        spans = [
            l for l in chapter["links"]
            if l["segment_code"] == seg and l.get("unit_code", 0) == unit
        ]
        if not spans:
            continue
        merged: dict[int, str] = {}
        for r in rows:
            if r.get("note_content"):
                merged.setdefault(r["note_num"], r["note_content"])
        nums = sorted(merged)
        cat = "".join(merged[k] for k in nums)
        marks = [i for i, ch in enumerate(cat) if ch == PARA]

        def to_raw(p: int) -> int:
            for m in marks:
                if m <= p:
                    p += 1
                else:
                    break
            return p

        base, starts = 0, []
        for k in nums:
            starts.append(base)
            base += len(merged[k])

        for l in spans:
            at = to_raw(l["start_loc"] - 1)
            end = to_raw(l["end_loc"] - 1) + 1
            idx = max((i for i, st in enumerate(starts) if st <= at), default=None)
            if idx is None or at >= starts[idx] + len(merged[nums[idx]]):
                continue
            out.append(
                {
                    "key": f"{chapter['b']}.{chapter['c']}.{seg}",
                    "n": nums[idx],
                    "at": at - starts[idx],
                    "len": end - at,
                }
            )
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("chapters", nargs="*", help="書:章,例如 41:14。省略則每卷取 2 章")
    ap.add_argument("--all", action="store_true", help="全部 1189 章")
    args = ap.parse_args()

    counts = chapter_counts()
    if args.chapters:
        jobs = [tuple(int(x) for x in c.split(":")) for c in args.chapters]
    elif args.all:
        jobs = [(b, c) for b, n in enumerate(counts, 1) for c in range(1, n + 1)]
    else:
        jobs = [(b, c) for b, n in enumerate(counts, 1) for c in sorted({1, max(1, n // 2)})]

    log(f"取 {len(jobs)} 章…")
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        chapters = list(ex.map(fetch, jobs))

    cuts: list[dict] = []
    for ch in chapters:
        cuts.extend(cuts_for(ch))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cuts, ensure_ascii=False), encoding="utf-8")
    log(f"{len(chapters)} 章,官方標了 {len(cuts)} 個引經區塊 → {OUT.relative_to(ROOT)}")

    log("\n跑比對(解析器在 TypeScript)…\n")
    r = subprocess.run(
        ["npx", "vitest", "run", "--config", "scripts/vitest.check.config.ts"],
        cwd=ROOT,
    )
    return 0 if r.returncode in (0, 1) else r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
