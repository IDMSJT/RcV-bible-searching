"""Three-way orthographic-variant comparison for the books we have on all three
sources: recoveryversion.com.tw (output/verse_old.json), line.twgbr.org (live),
and bible.com/YouVersion v4230 (--yv json).

For every verse present in all three with equal length (so positions line up),
record each position where the three chars are not all identical. Aggregate by
the {old,twgbr,bible} char-triple and report counts, so we can see, per variant,
which site uses which character.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from scrape_verse_twgbr import fetch_book, parse_book, norm

SCRIPT_DIR = Path(__file__).parent
OLD_VERSE = SCRIPT_DIR / "output" / "verse_old.json"
DEFAULT_YV = SCRIPT_DIR / "output" / "verse_youversion.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--yv", type=Path, default=DEFAULT_YV)
    ap.add_argument("--min", type=int, default=1, help="only show triples seen >= N times")
    args = ap.parse_args()

    old = {b["bookNo"]: b for b in json.loads(OLD_VERSE.read_text(encoding="utf-8"))["books"]}
    yv = {b["bookNo"]: b for b in json.loads(args.yv.read_text(encoding="utf-8"))["books"]}

    # triple (old, twgbr, bible) -> count ; and a sample location
    triples: Counter = Counter()
    samples: dict = {}
    cat = Counter()
    length_skips = 0
    compared = 0
    per_verse: list[str] = []   # every verse where the three differ (full text)
    len_diffs: list[str] = []   # verses skipped because lengths differ

    def who(o, t, y):
        if o == y and o != t:
            return "官網=bible≠twgbr"
        if t == y and t != o:
            return "twgbr=bible≠官網"
        if o == t and o != y:
            return "官網=twgbr≠bible"
        return "三版全不同"

    for bn in sorted(yv):
        if bn not in old:
            continue
        theirs = parse_book(fetch_book(bn))  # twgbr {chapter: {verse: text}}
        ob = old[bn]
        yb = {c["chapterNo"]: {v["verse"]: v["text"] for v in c["verses"]} for c in yv[bn]["chapters"]}
        old_ch = {c["chapterNo"]: {v["verse"]: v["text"] for v in c["verses"]} for c in ob["chapters"]}
        name = ob["name"]

        for ch in sorted(set(old_ch) & set(theirs) & set(yb)):
            for v in sorted(set(old_ch[ch]) & set(theirs[ch]) & set(yb[ch])):
                o = norm(old_ch[ch][v])
                t = norm(theirs[ch][v])
                y = norm(yb[ch][v])
                if len({len(o), len(t), len(y)}) != 1:
                    if not (o == t == y):
                        len_diffs.append(
                            f"{name} {ch}:{v} (長度不一，無法對位)\n    官網={o}\n    twgbr={t}\n    bible={y}"
                        )
                        length_skips += 1
                    continue
                compared += 1
                if o == t == y:
                    continue
                marks = []
                for oc, tc, yc in zip(o, t, y):
                    if oc == tc == yc:
                        continue
                    key = (oc, tc, yc)
                    triples[key] += 1
                    cat[who(oc, tc, yc)] += 1
                    samples.setdefault(key, f"{name} {ch}:{v}")
                    marks.append(f"        {oc} / {tc} / {yc}   ({who(oc, tc, yc)})")
                per_verse.append(
                    f"{name} {ch}:{v}\n    官網 ={o}\n    twgbr={t}\n    bible={y}\n"
                    + "\n".join(marks)
                )

    print(f"逐字對位比較的節數: {compared}  (因長度不一跳過 {length_skips})")
    print(f"三版有差異的位置種類: {len(triples)}\n")
    print(f"{'恢復本官網':<8} {'twgbr':<8} {'bible.com':<10} {'次數':>5}   範例")
    print("-" * 60)
    for (o, t, y), n in triples.most_common():
        if n < args.min:
            continue
        print(f"{o:<9} {t:<9} {y:<11} {n:>4}   {samples[(o, t, y)]}")

    out = SCRIPT_DIR / "output" / "cmp3_variants.txt"
    header = (
        "三版逐字對位差異(創世記)\n"
        "欄位順序:恢復本官網(recoveryversion.com.tw) / twgbr(line.twgbr.org) / bible.com(YouVersion v4230)\n\n"
        f"逐字對位節數 {compared};有差異位置 {sum(triples.values())} 處、{len(triples)} 種\n"
        + "  ".join(f"{k}:{n}" for k, n in cat.most_common()) + "\n\n"
        "== 差異字種類統計(官網字 / twgbr字 / bible字  次數  範例) ==\n"
        + "\n".join(
            f"{o} / {t} / {y}   {n:>4}   {who(o, t, y)}   {samples[(o, t, y)]}"
            for (o, t, y), n in triples.most_common()
        )
        + "\n\n\n== 每一節差異(完整經文) ==\n\n"
        + "\n\n".join(per_verse)
        + "\n\n\n== 長度不一、無法逐字對位的節(可能是真改寫) ==\n\n"
        + "\n\n".join(len_diffs)
        + "\n"
    )
    out.write_text(header, encoding="utf-8")
    print(f"\n全部差異已寫出 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
