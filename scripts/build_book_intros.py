#!/usr/bin/env python3
"""✅ 現役 — 從恢復本新版 API 取每卷書的書介與主題,併進 `public/outline.json`。

書介和綱目都是「進到一卷書時整份讀」,畫面上也相鄰,所以放同一個檔,不另開一份
給前端多抓一次。

三個 endpoint(名稱是從站上的 JS bundle 讀出來的,沒有公開文件):

    /api/getBookIntros      {content, note}   每卷 3～4 段
    /api/getBookIntroLinks  {note, start_loc, end_loc}  段裡引經的位置
    /api/getTopics          {content}         一行主題

`content` 的標題與內文之間固定是全形空格(66 卷皆然),標題有九種:著者、著時、
著地、受者、涵蓋時段、盡職時間、盡職地點、盡職對象、記載地點。段數與標題都因書
而異,所以存成有序的 label/text,而不是固定欄位。

引經的位置(getBookIntroLinks)不寫進輸出。書介的引經是行內文字本身,`parseRefs`
在渲染時讀得出來,而且讀得比那份資料多——對照 66 卷 240 段官方標記,我們的解析
涵蓋其中 236 段,另外找到 100 多段它沒有標的。存一份會多出一份要跟解析結果對齊
的東西。這裡仍然抓下來,只用來核對(--check)。

用法:
    cd scripts && .venv/bin/python build_book_intros.py --check   # 只比對,不寫檔
    cd scripts && .venv/bin/python build_book_intros.py           # 併進 public/outline.json

每卷快取於 scripts/cache/rv_intro/(gitignore);重跑只讀本機檔。
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "rv_intro"
OUTLINE = HERE.parent / "public" / "outline.json"
BASE = "https://www.recoveryversion.com.tw/api"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120 Safari/537.36"
)
SOURCE = "https://www.recoveryversion.com.tw/ (新版 API,VERSION=1)"
# 標題與內文之間的全形空格。
SEP = "　"

# 靠語意才判得出書卷的引經,寫明書卷簡稱。
#
# 馬太受者那一段是「本書A比馬可B，本書C比馬可D」的對照句;逗號後的那一個回到馬
# 太,但解析器看到的前一個引經是馬可,於是接成馬可二六17——馬可沒有二六章,所以
# 這一個現了形。全語料只有這一處(註解 29,919 個引經裡 0 處),所以列表,不立規則:
# 「比」在中文裡太常見(巴比倫、比喻、比方),以它為條件的規則沒有第二個樣本可驗。
#
# 代價是印出來的字多一個「太」。這裡選擇讓文字明確而非照抄,因為在會連結的版本
# 裡,連到哪裡比少一個字更要緊。
#
# 所有解析例外的總表見 scripts/PARSE_EXCEPTIONS.md。
FIXES: dict[tuple[int, str], list[tuple[str, str]]] = {
    (40, "受者"): [("二六17比", "太二六17比")],
}


def api(name: str, **params) -> list[dict]:
    q = urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(f"{BASE}/{name}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())


def fetch(book_no: int) -> str | None:
    f = CACHE / f"{book_no:02d}.json"
    if f.exists() and f.stat().st_size > 20:
        return None
    try:
        data = {
            "intros": api(
                "getBookIntros",
                VERSION=1,
                **{"output[]": ["content", "note"]},
                chapter_code=book_no,
                ORDER="id",
            ),
            "links": api("getBookIntroLinks", VERSION=1, chapter_code=book_no),
            "topic": api(
                "getTopics",
                VERSION=1,
                **{"output[]": ["content"]},
                chapter_code=book_no,
                LIMIT=1,
            ),
        }
    except Exception as e:  # noqa: BLE001 — 任何網路錯誤都回報,不中斷其餘卷
        return f"{book_no}: {e}"
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return None


def load(book_no: int) -> dict:
    return json.loads((CACHE / f"{book_no:02d}.json").read_text(encoding="utf-8"))


def split_label(content: str) -> tuple[str, str]:
    """「著者　摩西…」 → ('著者', '摩西…')。分隔符不在前六個字內就整段當內文。"""
    i = content.find(SEP)
    if 0 < i <= 6:
        return content[:i], content[i + 1 :].strip()
    return "", content.strip()


def build(book_no: int) -> dict:
    d = load(book_no)
    topic = (d["topic"][0]["content"] if d["topic"] else "").strip()
    sections = []
    for row in d["intros"]:
        label, text = split_label(row["content"])
        for old, new in FIXES.get((book_no, label), []):
            if old not in text:
                raise SystemExit(f"✗ 書{book_no}「{label}」找不到要修的「{old}」,來源可能改了")
            text = text.replace(old, new, 1)
        if text:
            sections.append({"label": label, "text": text})
    return {"topic": topic, "sections": sections}


def check(book_no: int) -> tuple[int, int, list[str]]:
    """官方標了幾段引經、我們的段落文字含不含它。位置是 1-based、閉開區間。"""
    d = load(book_no)
    by_note = {r["note"]: r["content"] for r in d["intros"]}
    total = covered = 0
    missed = []
    for link in d["links"]:
        content = by_note.get(link["note"], "")
        span = content[link["start_loc"] - 1 : link["end_loc"]]
        if not span:
            continue
        total += 1
        # 段落文字是原樣保留的(只切掉標題),所以官方標的字一定還在;這裡確認的是
        # 切標題沒有把引經切掉。
        _, text = split_label(content)
        if span in text or span in content:
            covered += 1
        else:
            missed.append(span)
    return total, covered, missed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只比對官方引經標記,不寫檔")
    args = ap.parse_args()

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        fails = [x for x in ex.map(fetch, range(1, 67)) if x]
    if fails:
        print(f"✗ 取不到 {len(fails)} 卷:{fails[:5]}", file=sys.stderr)
        return 1

    if args.check:
        t = c = 0
        for b in range(1, 67):
            bt, bc, missed = check(b)
            t += bt
            c += bc
            for m in missed:
                print(f"  書{b} 切標題後遺失:「{m}」", file=sys.stderr)
        print(f"官方標記 {t} 段,切標題後仍完整 {c} 段")
        return 0 if t == c else 1

    outline = json.loads(OUTLINE.read_text(encoding="utf-8"))
    intros = {b: build(b) for b in range(1, 67)}
    n_sections = 0
    for book in outline["books"]:
        got = intros.get(book["bookNo"])
        if not got:
            continue
        book["topic"] = got["topic"]
        book["intro"] = got["sections"]
        n_sections += len(got["sections"])
    outline["introSource"] = SOURCE

    before = OUTLINE.stat().st_size
    OUTLINE.write_text(
        json.dumps(outline, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    after = OUTLINE.stat().st_size
    print(f"寫入 {OUTLINE}")
    print(f"  書介 {n_sections} 段、主題 {sum(1 for v in intros.values() if v['topic'])} 卷")
    print(f"  {before / 1024:.0f} KB → {after / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
