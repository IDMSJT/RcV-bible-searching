"""Compare our old-site verse text (output/verse_old.json) with the new-site
edition (scrape_verse_twgbr), classifying each difference as variant / punct /
wording and writing the diff lists to output/cmp_*.txt.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scrape_verse_twgbr import CACHE_DIR, fetch_book, parse_book, norm

SCRIPT_DIR = Path(__file__).parent
VERSE_JSON = SCRIPT_DIR / "output" / "verse_old.json"


# Orthographic variant groups treated as equal for classification. Each char in
# a group is folded to the group's first char.
VARIANT_GROUPS = [
    "它牠", "乾干", "羣群", "那哪", "裏裡", "著着", "麼么嗎", "為爲",
    "甎磚", "侄姪", "崙侖", "啓啟", "麵面", "畧略", "託托", "隻只",
    "鉤鈎", "床牀", "梁樑", "彫雕", "回迴", "並併", "蹟跡", "綑捆", "貍狸",
    "餧餵", "栢柏", "粧妝", "妝粧", "陞升", "雇僱", "傚效", "羶膻", "燄焰",
]
VARIANT_MAP = {c: g[0] for g in VARIANT_GROUPS for c in g}
PUNCT = "，。；：、！？（）「」『』─－…‧"


def fold_variants(s: str) -> str:
    return "".join(VARIANT_MAP.get(c, c) for c in s)


def strip_punct(s: str) -> str:
    return "".join(c for c in s if c not in PUNCT)


def classify(a: str, b: str) -> str:
    """variant | punct | wording, given two non-identical (whitespace-normed) strings."""
    fa, fb = fold_variants(a), fold_variants(b)
    if fa == fb:
        return "variant"
    if strip_punct(fa) == strip_punct(fb):
        return "punct"
    return "wording"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int, help="single book (1-66)")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--show", type=int, default=30, help="how many diffs to print")
    args = ap.parse_args()

    ours = json.loads(VERSE_JSON.read_text(encoding="utf-8"))
    ours_by_book = {b["bookNo"]: b for b in ours["books"]}

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    books = [args.book] if args.book else list(range(1, 67))

    total = same = 0
    cats = {"variant": 0, "punct": 0, "wording": 0}
    wording_diffs: list[str] = []
    miss_ours: list[str] = []   # verse exists on new site, not in ours
    miss_new: list[str] = []    # verse exists in ours, not on new site

    for book_no in books:
        html = fetch_book(book_no, use_cache=not args.no_cache)
        theirs = parse_book(html)
        ob = ours_by_book[book_no]
        name = ob["name"]
        our_ch = {c["chapterNo"]: {v["verse"]: v["text"] for v in c["verses"]} for c in ob["chapters"]}

        all_ch = sorted(set(our_ch) | set(theirs))
        for ch in all_ch:
            ours_v = our_ch.get(ch, {})
            theirs_v = theirs.get(ch, {})
            for v in sorted(set(ours_v) | set(theirs_v)):
                total += 1
                a = ours_v.get(v)
                b = theirs_v.get(v)
                if a is None:
                    miss_ours.append(f"{name} {ch}:{v}\t新站={b}")
                elif b is None:
                    miss_new.append(f"{name} {ch}:{v}\t我們={a}")
                elif norm(a) == norm(b):
                    same += 1
                else:
                    cat = classify(norm(a), norm(b))
                    cats[cat] += 1
                    if cat == "wording":
                        dl = len(norm(b)) - len(norm(a))
                        wording_diffs.append(
                            f"{name} {ch}:{v}  (字數差 {dl:+d})\n    我們={a}\n    新站={b}"
                        )

    print(f"比對總節數: {total}")
    print(f"  完全相同: {same}")
    print(f"  正字變體差 (它/牠、那/哪、乾/干…): {cats['variant']}")
    print(f"  標點差: {cats['punct']}")
    print(f"  *用詞不同*: {cats['wording']}")
    print(f"  我們缺(新站有): {len(miss_ours)}，新站缺(我們有): {len(miss_new)}")

    shift = [d for d in wording_diffs if not d.split("\n")[0].endswith("(字數差 +0)")]
    outdir = VERSE_JSON.parent
    (outdir / "cmp_missing_newsite.txt").write_text("\n".join(miss_new), encoding="utf-8")
    (outdir / "cmp_missing_ours.txt").write_text("\n".join(miss_ours), encoding="utf-8")
    (outdir / "cmp_wording.txt").write_text("\n\n".join(wording_diffs), encoding="utf-8")
    (outdir / "cmp_wording_shift.txt").write_text("\n\n".join(shift), encoding="utf-8")
    print(f"\n已寫出 output/cmp_missing_newsite.txt ({len(miss_new)})")
    print(f"已寫出 output/cmp_missing_ours.txt ({len(miss_ours)})")
    print(f"已寫出 output/cmp_wording.txt ({len(wording_diffs)} 全部用詞不同)")
    print(f"已寫出 output/cmp_wording_shift.txt ({len(shift)} 字數有變、會位移註釋)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
