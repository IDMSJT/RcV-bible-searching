"""Compare the bible.com (YouVersion v4230) verse text against our current
public/verse.json (twgbr-based merge), to judge whether bible.com is a better
source. Classification mirrors dump_verse_diffs: fold known 異體字 pairs (so pure
orthographic differences don't count as real changes), then split the rest into
標點 vs 用字遣詞.

Run scrape_verse_youversion.py first (its output JSON is the --yv input).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scrape_verse_twgbr import norm
from merge_verse import _VARIANT_PAIRS
from dump_verse_diffs import FLIP_PAIRS, fold, strip_punct, PAIRS, union

SCRIPT_DIR = Path(__file__).parent
CUR_VERSE = SCRIPT_DIR.parent / "public" / "verse.json"
DEFAULT_YV = SCRIPT_DIR / "output" / "verse_youversion.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--yv", type=Path, default=DEFAULT_YV)
    ap.add_argument("--show", type=int, default=25)
    args = ap.parse_args()

    cur = json.loads(CUR_VERSE.read_text(encoding="utf-8"))
    yv = json.loads(args.yv.read_text(encoding="utf-8"))
    yv_books = {b["bookNo"]: b for b in yv["books"]}
    cur_books = {b["bookNo"]: b for b in cur["books"]}

    total = same = 0
    variant = []
    punct = []
    wording = []
    miss_cur = []  # bible.com has, ours doesn't
    miss_yv = []   # ours has, bible.com doesn't

    for bn in sorted(yv_books):
        yb = yv_books[bn]
        cb = cur_books.get(bn)
        if cb is None:
            continue
        name = yb["name"]
        yv_ch = {c["chapterNo"]: {v["verse"]: v["text"] for v in c["verses"]} for c in yb["chapters"]}
        cur_ch = {c["chapterNo"]: {v["verse"]: v["text"] for v in c["verses"]} for c in cb["chapters"]}
        for ch in sorted(set(yv_ch) | set(cur_ch)):
            yvv = yv_ch.get(ch, {})
            cvv = cur_ch.get(ch, {})
            for v in sorted(set(yvv) | set(cvv)):
                y = yvv.get(v)
                o = cvv.get(v)
                if y is None:
                    miss_yv.append(f"{name} {ch}:{v}\t我們={o}")
                    continue
                if o is None:
                    miss_cur.append(f"{name} {ch}:{v}\tbible.com={y}")
                    continue
                total += 1
                a, n = norm(o), norm(y)
                if a == n:
                    same += 1
                    continue
                entry = f"{name} {ch}:{v}\n    我們={o}\n    bible={y}"
                fa, fn = fold(a), fold(n)
                if fa == fn:
                    variant.append(entry)
                elif strip_punct(fa) == strip_punct(fn):
                    punct.append(entry)
                else:
                    wording.append(entry)

    print(f"比對總節數: {total}")
    print(f"  完全相同: {same}")
    print(f"  異體字差: {len(variant)}")
    print(f"  標點/引號差: {len(punct)}")
    print(f"  *用字遣詞差*: {len(wording)}")
    print(f"  bible.com 有、我們缺: {len(miss_cur)}  我們有、bible.com 缺: {len(miss_yv)}")

    outdir = SCRIPT_DIR / "output"
    text = (
        f"# 異體字差異({len(variant)})\n\n" + "\n\n".join(variant)
        + f"\n\n\n# 標點/引號差異({len(punct)})\n\n" + "\n\n".join(punct)
        + f"\n\n\n# 真的用字遣詞差異({len(wording)})\n\n" + "\n\n".join(wording)
        + "\n"
    )
    (outdir / "cmp_yv_diffs.txt").write_text(text, encoding="utf-8")
    (outdir / "cmp_yv_missing.txt").write_text(
        "## bible.com 有、我們缺\n" + "\n".join(miss_cur)
        + "\n\n## 我們有、bible.com 缺\n" + "\n".join(miss_yv),
        encoding="utf-8",
    )
    print("→ output/cmp_yv_diffs.txt, output/cmp_yv_missing.txt")

    if wording:
        print("\n用字遣詞差異前幾筆:")
        for w in wording[: args.show]:
            print(w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
