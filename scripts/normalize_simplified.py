#!/usr/bin/env python3
"""Normalise stray Simplified-Chinese characters in public/annotations.json.

The EPUB-sourced annotations are meant to be Traditional Chinese but contain
some Simplified characters (overwhelmingly 着 for 著, plus 于→於 and ~20 others).

We use OpenCC **s2tw**, not s2twp: the "p" (phrases) variant does Taiwan
*vocabulary* substitution (扩展→擴充套件, 的士→計程車) that mangles this text.
And we do NOT accept every s2tw change either — it still "standardises" many
already-correct Traditional characters to Taiwan variant forms (升→昇, 念→唸,
准→準, 台→臺, 污→汙 …) which would corrupt the text. Instead:

  1. Convert each note with OpenCC s2tw to get a context-aware proposal
     (so one-to-many merges resolve correctly: 公里 stays 里, 生命里 → 生命裡).
  2. Accept a change ONLY where the original character is in WHITELIST — the
     set of characters we've confirmed are genuine Simplified contamination
     here. Everything else is left untouched.

All changes are 1-char→1-char, so note `offset` fields stay valid; any note
whose conversion would change length is skipped and reported.
"""
import json
import sys
from collections import Counter
from pathlib import Path

from opencc import OpenCC

# Confirmed Simplified characters to fix (A = clearly simplified, B = simplified
# merges verified context-safe in this data). 游 is intentionally excluded:
# its only use is 游手好閒, where 游 is already valid Traditional.
WHITELIST = set("着于领几羡杠帘柜泄长国须里征后仆余涂")

ANN = Path(__file__).resolve().parent.parent / "public" / "annotations.json"


def normalize(text: str, cc: OpenCC):
    proposed = cc.convert(text)
    if len(proposed) != len(text):
        return text, None  # length changed -> skip, caller reports
    changes = Counter()
    out = []
    for orig, conv in zip(text, proposed):
        if orig != conv and orig in WHITELIST:
            out.append(conv)
            changes[f"{orig}→{conv}"] += 1
        else:
            out.append(orig)
    return "".join(out), changes


def main():
    cc = OpenCC("s2tw")
    data = json.loads(ANN.read_text(encoding="utf-8"))

    total_changes = Counter()
    notes_touched = 0
    notes_total = 0
    skipped = []

    for book in data["books"]:
        for chap in book["chapters"]:
            for verse in chap["verses"]:
                for note in verse.get("notes", []):
                    notes_total += 1
                    text = note.get("text", "")
                    fixed, changes = normalize(text, cc)
                    if changes is None:
                        skipped.append(f"{book['bookNo']}/{chap['chapterNo']}:{verse['verse']}註{note['n']}")
                        continue
                    if fixed != text:
                        note["text"] = fixed
                        notes_touched += 1
                        total_changes.update(changes)

    apply = "--apply" in sys.argv
    print(f"掃描 {notes_total} 條註釋；{'將修改' if apply else '預計修改'} {notes_touched} 條")
    print("變更明細（字→繁：次數）：")
    for pair, n in total_changes.most_common():
        print(f"  {pair}: {n}")
    print(f"合計 {sum(total_changes.values())} 字、{len(total_changes)} 種")
    if skipped:
        print(f"\n⚠ 長度改變而跳過 {len(skipped)} 條（需人工看）：{', '.join(skipped[:20])}")

    if apply:
        ANN.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"\n✓ 已寫回 {ANN}")
    else:
        print("\n(預覽模式；加 --apply 才會寫回檔案)")


if __name__ == "__main__":
    main()
