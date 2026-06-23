"""Dump old-vs-new verse text differences, split into variant vs wording.

Classification does NOT use length. Every character that is part of a known
異體字 pair is folded to a canonical form (union-find over all pairs); if the two
verses are equal after folding, the difference is purely orthographic (異體字),
otherwise it is a genuine wording change (用字遣詞).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from scrape_verse_twgbr import fetch_book, parse_book, norm
from merge_verse import _VARIANT_PAIRS

SCRIPT_DIR = Path(__file__).parent
OLD_VERSE = SCRIPT_DIR / "output" / "verse.json"
OUT = SCRIPT_DIR / "output" / "verse_diffs.txt"

# All 異體字 pairs: the revert set plus the few we flipped to the new form. Both
# directions/variants are unioned to one canonical char for classification.
FLIP_PAIRS = "複→復 瞭→了 什→甚 那→哪 儘→盡"
PAIRS = [
    tuple(p.split("→"))
    for p in (_VARIANT_PAIRS + " " + FLIP_PAIRS).split()
    if "→" in p
]

_parent: dict[str, str] = {}


def find(x: str) -> str:
    _parent.setdefault(x, x)
    root = x
    while _parent[root] != root:
        root = _parent[root]
    while _parent[x] != root:
        _parent[x], x = root, _parent[x]
    return root


def union(a: str, b: str) -> None:
    ra, rb = find(a), find(b)
    if ra != rb:
        _parent[ra] = rb


for a, b in PAIRS:
    union(a, b)


def fold(s: str) -> str:
    return "".join(find(c) for c in s)


PUNCT = set("，。；：、！？（）()「」『』《》〈〉［］【】〔〕“”‘’\"'…—─－～~·．,.;:!?[]{}　 ")


def strip_punct(s: str) -> str:
    return "".join(c for c in s if c not in PUNCT)


def main() -> int:
    old = json.loads(OLD_VERSE.read_text(encoding="utf-8"))
    variant: list[str] = []
    punct: list[str] = []
    wording: list[str] = []

    for b in old["books"]:
        theirs = parse_book(fetch_book(b["bookNo"]))
        for c in b["chapters"]:
            tv = theirs.get(c["chapterNo"], {})
            for v in c["verses"]:
                nt = tv.get(v["verse"])
                if nt is None:
                    continue
                a, n = norm(v["text"]), norm(nt)
                if a == n:
                    continue
                entry = f"{b['name']} {c['chapterNo']}:{v['verse']}\n    舊={v['text']}\n    新={nt}"
                fa, fn = fold(a), fold(n)
                if fa == fn:
                    variant.append(entry)
                elif strip_punct(fa) == strip_punct(fn):
                    punct.append(entry)
                else:
                    wording.append(entry)

    text = (
        f"# 異體字差異({len(variant)})\n\n" + "\n\n".join(variant)
        + f"\n\n\n# 標點/引號差異({len(punct)})\n\n" + "\n\n".join(punct)
        + f"\n\n\n# 真的用字遣詞差異({len(wording)})\n\n" + "\n\n".join(wording)
        + "\n"
    )
    OUT.write_text(text, encoding="utf-8")
    print(f"異體字: {len(variant)}  標點/引號: {len(punct)}  用字遣詞: {len(wording)}")
    print(f"→ {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
