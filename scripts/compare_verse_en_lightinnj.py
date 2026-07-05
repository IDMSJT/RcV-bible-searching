#!/usr/bin/env python3
"""compare_verse_en_lightinnj.py — 把 lightinnj.org 的恢復本英文(1.htm~1189.htm,
一頁一章)逐節比對我們的 public/verse_en.json,找出差異。

頁面結構(GBK):每節一列
  <a name=N>章:節</a></td><td class=td>中文<br>English</td>

用法:
  cd scripts && . .venv/bin/activate
  python compare_verse_en_lightinnj.py

輸出:
  scripts/verse_en_diff.json   完整差異(gap / missing / wording)
  終端機:摘要
頁面快取於 scripts/cache/lightinnj/(gitignore);重跑只讀本機檔。
"""
import concurrent.futures
import html as htmllib
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "lightinnj"
CANON = HERE.parent / "src" / "data" / "canon.ts"
VERSE_EN = HERE.parent / "public" / "verse_en.json"
OUT = HERE / "verse_en_diff.json"
URL = "http://www.lightinnj.org/cebible/{}.htm"

ROW_RE = re.compile(r"<a name=\d+>(\d+):(\d+)</a></td><td class=td>(.*?)</td>", re.S)
BR_RE = re.compile(r"<br\s*/?>", re.I)
TAG_RE = re.compile(r"<[^>]*>")
WS_RE = re.compile(r"\s+")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def chapter_counts() -> list[int]:
    txt = CANON.read_text(encoding="utf-8")
    return [int(m.group(1)) for m in re.finditer(r"\[\s*'[^']*',\s*(\d+)\s*\]", txt)]


def fetch(page: int) -> bytes:
    f = CACHE / f"{page}.htm"
    if f.exists() and f.stat().st_size > 0:
        return f.read_bytes()
    for _ in range(3):
        try:
            data = urlopen(
                Request(URL.format(page), headers={"User-Agent": "Mozilla/5.0"}),
                timeout=25,
            ).read()
            if data:
                f.write_bytes(data)
                return data
        except Exception:  # noqa: BLE001 — retry any network error
            continue
    log(f"  ✗ page {page} 抓取失敗")
    return b""


def norm(s: str) -> str:
    return WS_RE.sub(" ", htmllib.unescape(s)).strip()


def parse_english(page_bytes: bytes) -> dict[tuple[int, int], str]:
    """(chapter, verse) → English text (whitespace-normalised)."""
    text = page_bytes.decode("gbk", errors="replace")
    out: dict[tuple[int, int], str] = {}
    for m in ROW_RE.finditer(text):
        ch, v, cell = int(m.group(1)), int(m.group(2)), m.group(3)
        parts = BR_RE.split(cell, maxsplit=1)  # Chinese <br> English(可能還有 <br>)
        eng = parts[1] if len(parts) > 1 else ""
        out[(ch, v)] = norm(TAG_RE.sub(" ", eng))
    return out


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    counts = chapter_counts()
    assert len(counts) == 66, f"canon 解析到 {len(counts)} 卷,應為 66"
    # page → (bookNo, chapter)
    page_map: dict[int, tuple[int, int]] = {}
    page = 1
    for b, n in enumerate(counts, start=1):
        for c in range(1, n + 1):
            page_map[page] = (b, c)
            page += 1
    total_pages = page - 1  # 1189

    log(f"抓取 {total_pages} 頁(已快取的會跳過)…")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(fetch, range(1, total_pages + 1)))

    # lightinnj: bookNo → chapter → verse → english
    light: dict[tuple[int, int, int], str] = {}
    for pg, (b, c) in page_map.items():
        data = fetch(pg)
        if not data:
            continue
        for (ch, v), eng in parse_english(data).items():
            if ch == c:  # ignore stray rows from other chapters
                light[(b, c, v)] = eng

    ours_raw = json.loads(VERSE_EN.read_text(encoding="utf-8"))
    ours: dict[tuple[int, int, int], str] = {}
    for bk in ours_raw["books"]:
        for ch in bk["chapters"]:
            for ve in ch["verses"]:
                ours[(bk["bookNo"], ch["chapterNo"], ve["verse"])] = norm(ve.get("text", ""))

    gap = []  # ours empty/missing, light has text
    missing_in_light = []  # ours has text, light doesn't
    wording = []  # both have text, differ
    for key, o in ours.items():
        l = light.get(key)
        if o and (l is None or not l):
            missing_in_light.append({"ref": ref(key), "ours": o})
        elif not o and l:
            gap.append({"ref": ref(key), "light": l})
        elif o and l and o != l:
            wording.append({"ref": ref(key), "ours": o, "light": l})
    # light-only verses (versification differences)
    light_only = [
        {"ref": ref(k), "light": v} for k, v in light.items() if k not in ours and v
    ]

    OUT.write_text(
        json.dumps(
            {
                "_comment": "lightinnj RcV 英文 vs public/verse_en.json 逐節比對",
                "counts": {
                    "gap(我們空、它有)": len(gap),
                    "wording(兩邊都有但用字不同)": len(wording),
                    "missing_in_light(我們有、它沒有)": len(missing_in_light),
                    "light_only(它有、我們沒有此節)": len(light_only),
                },
                "gap": gap,
                "wording": wording,
                "missing_in_light": missing_in_light,
                "light_only": light_only,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    log("─" * 48)
    log(f"gap(我們空、它有)        : {len(gap)}")
    log(f"wording(用字不同)         : {len(wording)}")
    log(f"missing_in_light(它缺)    : {len(missing_in_light)}")
    log(f"light_only(多出的節)      : {len(light_only)}")
    log(f"詳見 {OUT.name}")


def ref(key: tuple[int, int, int]) -> str:
    b, c, v = key
    return f"{b}:{c}:{v}"


if __name__ == "__main__":
    main()
