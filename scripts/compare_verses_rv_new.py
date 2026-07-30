#!/usr/bin/env python3
"""逐字比對 recoveryversion.com.tw 新版 API 的經文 vs 我們的 public/verse.json。

新版站是 Vue SPA,經文走免驗證的 JSON API:
    /api/getVerses?VERSION=1&output[]=content&output[]=unit_code&output[]=segment_code
                  &chapter_code=<卷序>&section_code=<章>&ORDER=id
其中 segment_code=節、unit_code=0 整節 / 1 上 / 2 下(同節分段時分列回傳)。

用法:
    cd scripts && .venv/bin/python compare_verses_rv_new.py

輸出:
    scripts/rv_new_verse_diff.json   完整差異
    終端機:摘要 + 差異字對統計
每章原始回應快取於 scripts/cache/rv_new/(gitignore);重跑只讀本機檔。
"""
from __future__ import annotations

import concurrent.futures
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "rv_new"
CANON = HERE.parent / "src" / "data" / "canon.ts"
VERSE = HERE.parent / "public" / "verse.json"
OUT = HERE / "rv_new_verse_diff.json"
API = "https://www.recoveryversion.com.tw/api/getVerses"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def chapter_counts() -> list[int]:
    """每卷章數(66 個),取自 canon.ts。"""
    txt = CANON.read_text(encoding="utf-8")
    return [int(m.group(1)) for m in re.finditer(r"\[\s*'[^']*',\s*(\d+)\s*\]", txt)]


def fetch(bc: tuple[int, int]) -> tuple[tuple[int, int], list | None]:
    book, chap = bc
    f = CACHE / f"{book:02d}.{chap:03d}.json"
    if f.exists() and f.stat().st_size > 0:
        try:
            return bc, json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass  # 快取壞了就重抓
    q = urllib.parse.urlencode(
        [
            ("VERSION", 1),
            ("output[]", "content"),
            ("output[]", "unit_code"),
            ("output[]", "segment_code"),
            ("chapter_code", book),
            ("section_code", chap),
            ("ORDER", "id"),
        ]
    )
    for _ in range(3):
        try:
            with urllib.request.urlopen(f"{API}?{q}", timeout=30) as r:
                rows = json.load(r)
            f.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
            return bc, rows
        except Exception:  # noqa: BLE001 — 任何網路錯誤都重試
            continue
    log(f"  ✗ {book}:{chap} 抓取失敗")
    return bc, None


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def join_verses(rows: list) -> dict[int, str]:
    """同 segment_code 依 unit_code 串成整節。"""
    by: dict[int, list[tuple[int, str]]] = {}
    for r in rows:
        by.setdefault(r["segment_code"], []).append((r.get("unit_code", 0), r.get("content", "")))
    return {seg: norm("".join(c for _, c in sorted(parts))) for seg, parts in by.items()}


def main() -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    counts = chapter_counts()
    assert len(counts) == 66, f"canon 解析到 {len(counts)} 卷,應為 66"
    todo = [(b, c) for b, n in enumerate(counts, start=1) for c in range(1, n + 1)]
    log(f"共 {len(todo)} 章(已快取的會跳過)…")

    rv: dict[tuple[int, int, int], str] = {}
    failed = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for (b, c), rows in ex.map(fetch, todo):
            done += 1
            if done % 100 == 0:
                log(f"  …{done}/{len(todo)}")
            if rows is None:
                failed.append(f"{b}:{c}")
                continue
            for seg, text in join_verses(rows).items():
                rv[(b, c, seg)] = text

    ours_raw = json.loads(VERSE.read_text(encoding="utf-8"))
    ours: dict[tuple[int, int, int], str] = {}
    for bk in ours_raw["books"]:
        for ch in bk["chapters"]:
            for v in ch["verses"]:
                ours[(bk["bookNo"], ch["chapterNo"], v["verse"])] = norm(v["text"])

    same = 0
    glyph: list[dict] = []      # 同長度、有字元差異
    length: list[dict] = []     # 長度不同(真正的改寫)
    only_ours: list[str] = []
    only_rv: list[str] = []
    pairs: dict[str, int] = {}

    ref = lambda k: f"{k[0]}:{k[1]}:{k[2]}"  # noqa: E731

    for k in sorted(set(ours) | set(rv)):
        o, r = ours.get(k), rv.get(k)
        if not r:
            only_ours.append(ref(k))
            continue
        if not o:
            only_rv.append(ref(k))
            continue
        if o == r:
            same += 1
            continue
        if len(o) == len(r):
            diffs = [(i, a, b) for i, (a, b) in enumerate(zip(o, r)) if a != b]
            for _, a, b in diffs:
                pairs[f"{a}→{b}"] = pairs.get(f"{a}→{b}", 0) + 1
            glyph.append({"ref": ref(k), "ours": o, "rv": r,
                          "diffs": [{"i": i, "ours": a, "rv": b} for i, a, b in diffs]})
        else:
            length.append({"ref": ref(k), "ours": o, "rv": r})

    OUT.write_text(json.dumps({
        "_comment": "新版 recoveryversion.com.tw API 經文 vs public/verse.json 全書逐字比對",
        "counts": {
            "identical": same,
            "glyph_diff(同長度)": len(glyph),
            "length_diff(改寫)": len(length),
            "only_ours": len(only_ours),
            "only_rv": len(only_rv),
            "fetch_failed": len(failed),
        },
        "char_pairs": dict(sorted(pairs.items(), key=lambda x: -x[1])),
        "glyph_diff": glyph,
        "length_diff": length,
        "only_ours": only_ours,
        "only_rv": only_rv,
        "fetch_failed": failed,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    total = same + len(glyph) + len(length)
    log("─" * 52)
    log(f"兩邊都有的節         : {total:,}")
    log(f"  完全相同           : {same:,}  ({100*same/total:.3f}%)")
    log(f"  同長度但有異字     : {len(glyph)}")
    log(f"  長度不同(改寫)     : {len(length)}")
    log(f"只有我們有           : {len(only_ours)}")
    log(f"只有新版 RV 有       : {len(only_rv)}")
    log(f"抓取失敗             : {len(failed)}")
    if pairs:
        log("\n差異字對:")
        for p, n in sorted(pairs.items(), key=lambda x: -x[1]):
            log(f"  {p}  ×{n}")
    log(f"\n詳見 {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
