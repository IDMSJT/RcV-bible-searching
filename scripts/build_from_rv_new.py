#!/usr/bin/env python3
"""從 recoveryversion.com.tw 新版 API 建立經文 / 註解 / 串珠三份資料。

站台是 Vue SPA,資料走免驗證的 JSON API(chapter_code=卷序、section_code=章、
segment_code=節、unit_code=0 整節 / 1 上 / 2 下):

    /api/getVerses     經文     content, unit_code, segment_code
    /api/getFootnotes  註解     note_loc, note_num, note_content
                                同一 note_num 可有多列:第一列帶內文,其餘
                                note_content 為空,只提供額外的掛載位置
    /api/getFoots      串珠     loc, beaded(標號 a/b/c), beaded_content(引經字串)

`note_loc` / `loc` 是 1-based,且相對於所屬的 unit;本檔一律換算成「整節文字中的
0-based 字元 offset」,與既有的 Mark.s / Annotation.offset 一致。

人名/地名/補字的 marks 這個 API 沒有,沿用現有 public/verse.json(YouVersion 來源)
的 marks —— 兩邊經文逐字等長(見 compare_verses_rv_new.py),offset 可直接套用。

用法:
    cd scripts && .venv/bin/python build_from_rv_new.py

輸出(先寫到 scripts/output/,確認後再覆蓋 public/):
    output/verse.json  output/annotations.json  output/crossrefs.json
每章原始回應快取於 scripts/cache/rv_new*/(gitignore)。
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
CANON = HERE.parent / "src" / "data" / "canon.ts"
# marks 的來源:YouVersion 管線產出的原始 verse.json 快照(scrape_verse_youversion.py)。
# 刻意不讀 public/verse.json —— 那份會被本檔覆蓋,offset 也已轉成 UTF-16,再讀會二次換算。
CUR_VERSE = HERE / "sources" / "verse_youversion.json"
OUTDIR = HERE / "output"
BASE = "https://www.recoveryversion.com.tw/api"

ENDPOINTS = {
    "verses": ("getVerses", HERE / "cache" / "rv_new",
               [("output[]", "content"), ("output[]", "unit_code"),
                ("output[]", "segment_code"), ("ORDER", "id")]),
    "notes": ("getFootnotes", HERE / "cache" / "rv_new_notes", []),
    "foots": ("getFoots", HERE / "cache" / "rv_new_foots", []),
}


# 兩處註解的引經,寫成裸的「N節」而句意指著上一個引經所在的書卷。解析器讀不出來
# ——「前面19～20節」的形狀和「本篇25～27節」一模一樣,而後者確實指本篇,全語料 20
# 處都是。所以規則照顧多數,這兩處補書名。
#
# 這兩處恢復本官網自己也標錯(getFootnoteLinks 把它們切成獨立的 span,等於解成本
# 書),所以不是我們讀錯,是原文省略得太多。查證見 scripts/PARSE_EXCEPTIONS.md。
#
# 代價是印出來的字多幾個。和書介的 FIXES 一樣,在會連結的版本裡,連到哪裡比少幾
# 個字更要緊。note_loc 是經文裡的位置,不在註解文字裡,所以改這裡不動錨點。
NOTE_FIXES: dict[tuple[int, int, int, int], list[tuple[str, str]]] = {
    # 可十四20註1:「主的晚餐」在路二二19～20,不在可十四19～20。
    (41, 14, 20, 1): [("是在前面19～20節題起的", "是在前面路二二19～20節題起的")],
    # 路十一49註1:「所差來的」對應代下二四19「但神仍遣申言者到他們那裏」。
    (42, 11, 49, 1): [("而擴大前文19節的話", "而擴大前文代下二四19節的話")],
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def chapter_counts() -> list[int]:
    txt = CANON.read_text(encoding="utf-8")
    return [int(m.group(1)) for m in re.finditer(r"\[\s*'[^']*',\s*(\d+)\s*\]", txt)]


def fetch(kind: str, book: int, chap: int):
    ep, cache, extra = ENDPOINTS[kind]
    cache.mkdir(parents=True, exist_ok=True)
    f = cache / f"{book:02d}.{chap:03d}.json"
    if f.exists() and f.stat().st_size > 0:
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    q = urllib.parse.urlencode(
        [("VERSION", 1), ("chapter_code", book), ("section_code", chap), *extra]
    )
    for _ in range(3):
        try:
            with urllib.request.urlopen(f"{BASE}/{ep}?{q}", timeout=30) as r:
                rows = json.load(r)
            f.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
            return rows
        except Exception:  # noqa: BLE001
            continue
    log(f"  ✗ {kind} {book}:{chap}")
    return None


def u16_index(text: str) -> list[int]:
    """code-point 索引 → UTF-16 code-unit 索引(含 len 這一格,供 exclusive end 用)。

    JS 的字串索引是 UTF-16 code unit,非 BMP 字元(如賽11:1 的 𣎴 U+233B4)佔兩格。
    所有寫進 JSON 的 offset 都要走這張表,否則該字之後的位置在前端會差一格。
    """
    out = [0] * (len(text) + 1)
    n = 0
    for i, ch in enumerate(text):
        out[i] = n
        n += 2 if ord(ch) > 0xFFFF else 1
    out[len(text)] = n
    return out


def units_of(rows: list) -> dict[int, list[tuple[int, str]]]:
    """{節: [(unit_code, 文字), …]},unit 由小到大。"""
    by: dict[int, list[tuple[int, str]]] = {}
    for r in rows:
        by.setdefault(r["segment_code"], []).append(
            (r.get("unit_code", 0), r.get("content", ""))
        )
    for parts in by.values():
        parts.sort()
    return by


def main() -> int:
    counts = chapter_counts()
    assert len(counts) == 66, f"canon 解析到 {len(counts)} 卷,應為 66"
    todo = [(b, c) for b, n in enumerate(counts, start=1) for c in range(1, n + 1)]

    # ── 抓取(三個 endpoint × 1189 章,已快取的直接讀)
    data: dict[tuple[int, int], dict] = {}
    for kind in ("verses", "notes", "foots"):
        log(f"抓取 {kind} …")
        done = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(fetch, kind, b, c): (b, c) for b, c in todo}
            for fu in concurrent.futures.as_completed(futs):
                bc = futs[fu]
                data.setdefault(bc, {})[kind] = fu.result()
                done += 1
                if done % 200 == 0:
                    log(f"  …{done}/{len(todo)}")

    # ── 既有 marks / 書名(YouVersion 來源)
    cur = json.loads(CUR_VERSE.read_text(encoding="utf-8"))
    marks: dict[tuple[int, int, int], list] = {}
    book_name: dict[int, str] = {}
    old_text: dict[tuple[int, int, int], str] = {}
    for bk in cur["books"]:
        book_name[bk["bookNo"]] = bk["name"]
        for ch in bk["chapters"]:
            for v in ch["verses"]:
                k = (bk["bookNo"], ch["chapterNo"], v["verse"])
                old_text[k] = v["text"]
                if v.get("marks"):
                    marks[k] = v["marks"]

    books, notes_out, refs_out = [], {}, {}
    stats = {"verses": 0, "len_mismatch": 0, "notes": 0, "note_anchors": 0,
             "refs": 0, "ref_anchors": 0, "ws_in_content": 0, "orphan_note": 0, "orphan_ref": 0}

    for b, n_ch in enumerate(counts, start=1):
        chapters = []
        for c in range(1, n_ch + 1):
            d = data.get((b, c), {})
            vrows = d.get("verses") or []
            if not vrows:
                continue
            uni = units_of(vrows)
            verses = []
            # 每節:整節文字 + 各 unit 的起始 offset(供 note/ref 的 loc 換算)
            prefix: dict[int, dict[int, int]] = {}
            text_of: dict[int, str] = {}
            for seg, parts in sorted(uni.items()):
                acc, pos = [], 0
                prefix[seg] = {}
                for ucode, txt in parts:
                    if re.search(r"\s", txt):
                        stats["ws_in_content"] += 1
                    prefix[seg][ucode] = pos
                    acc.append(txt)
                    pos += len(txt)
                text_of[seg] = "".join(acc)

            u16: dict[int, list[int]] = {seg: u16_index(t) for seg, t in text_of.items()}

            for seg, text in sorted(text_of.items()):
                k = (b, c, seg)
                entry: dict = {"verse": seg, "text": text}
                if len(uni[seg]) > 1:
                    entry["segments"] = [t for _, t in uni[seg]]
                ot = old_text.get(k)
                if ot is not None and len(ot) != len(text):
                    stats["len_mismatch"] += 1
                elif k in marks:
                    # 舊 marks 的 offset 是照 YouVersion 文字算的 code-point 索引;
                    # 兩邊逐字等長,所以 code-point 位置可直接沿用,只需轉成 UTF-16。
                    m16 = u16[seg]
                    entry["marks"] = [
                        {**m, "s": m16[m["s"]], "e": m16[m["e"]]} for m in marks[k]
                    ]
                verses.append(entry)
                stats["verses"] += 1

            def off(seg: int, ucode: int, loc: int) -> int | None:
                p = prefix.get(seg, {}).get(ucode)
                if p is None:
                    return None
                cp = p + loc - 1
                tbl = u16.get(seg)
                if tbl is None or not (0 <= cp < len(tbl) - 1):
                    return None
                return tbl[cp]

            # ── 註解:同 (節, 註號) 多列 → 一則註解、多個 offset
            grp: dict[tuple[int, int], list] = {}
            for r in d.get("notes") or []:
                grp.setdefault((r["segment_code"], r["note_num"]), []).append(r)
            for (seg, num), rows in sorted(grp.items()):
                # 站方用 ˍ (U+02CD) 標示分段(一律緊接在句尾標點之後);換成換行,
                # 前端才切得出段落。一對一替換,所以 offset 不受影響。
                body = next(
                    (r["note_content"] for r in rows if r.get("note_content")), ""
                ).replace("\u02cd", "\n")
                offs = sorted(
                    o for r in rows
                    if (o := off(seg, r.get("unit_code", 0), r["note_loc"])) is not None
                )
                for old, new in NOTE_FIXES.get((b, c, seg, num), []):
                    if old not in body:
                        log(f"  ⚠ NOTE_FIXES 找不到 {b}.{c}.{seg} 註{num}「{old}」")
                    body = body.replace(old, new)
                if not body or not offs:
                    stats["orphan_note"] += 1
                    continue
                notes_out.setdefault(f"{b}.{c}.{seg}", []).append(
                    {"n": num, "offsets": offs, "text": body}
                )
                stats["notes"] += 1
                stats["note_anchors"] += len(offs)

            # ── 串珠:和註解同樣的形狀 —— 同一個標號可有多列,第一列帶引經
            # 字串,其餘 beaded_content 為空,只是該串珠的額外掛載位置。
            fgrp: dict[tuple[int, str], list] = {}
            for r in d.get("foots") or []:
                fgrp.setdefault((r["segment_code"], r.get("beaded", "")), []).append(r)
            for (seg, mark), rows in sorted(fgrp.items()):
                body = next((r["beaded_content"] for r in rows if r.get("beaded_content")), "")
                offs = sorted(
                    o for r in rows
                    if (o := off(seg, r.get("unit_code", 0), r["loc"])) is not None
                )
                if not body or not offs:
                    stats["orphan_ref"] += 1
                    continue
                refs_out.setdefault(f"{b}.{c}.{seg}", []).append(
                    {"m": mark, "offsets": offs, "refs": body}
                )
                stats["refs"] += 1
                stats["ref_anchors"] += len(offs)

            chapters.append({"chapterNo": c, "verses": verses})
        books.append({"bookNo": b, "name": book_name.get(b, ""), "chapters": chapters})

    OUTDIR.mkdir(parents=True, exist_ok=True)
    src = "https://www.recoveryversion.com.tw/ (新版 API,VERSION=1)"
    dump = lambda p, o: p.write_text(  # noqa: E731
        json.dumps(o, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    dump(OUTDIR / "verse.json", {
        "name": "聖經恢復本", "lang": "zh-TW",
        "source": f"{src};marks 沿用 YouVersion v4230", "books": books})
    dump(OUTDIR / "annotations.json", {"source": src, "notes": notes_out})
    dump(OUTDIR / "crossrefs.json", {"source": src, "refs": refs_out})

    log("─" * 52)
    for k, v in stats.items():
        log(f"  {k:<16}{v:,}")
    log(f"  註解 key 數      {len(notes_out):,}")
    log(f"  串珠 key 數      {len(refs_out):,}")
    for f in ("verse.json", "annotations.json", "crossrefs.json"):
        log(f"  output/{f:<18}{(OUTDIR / f).stat().st_size / 1048576:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
