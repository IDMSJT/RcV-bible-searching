#!/usr/bin/env python3
"""Normalise stray Simplified-Chinese characters to Traditional.

The EPUB-sourced annotations are meant to be Traditional Chinese but contain
some Simplified characters (overwhelmingly 着 for 著, plus 于→於 and ~16 others).
`extract_annotations.py` imports `normalize_text` and applies it as notes are
pulled from the EPUB, so a fresh `scrape_annotations.py` run is already clean.
Run this module directly to (re)normalise an existing public/annotations.json.

(verse.json / outline.json come from YouVersion zh-TW and are already clean —
do NOT run this on them: their proper names 于沙希悉 / 泄撒 and words 鄰里 / 天后
would be wrongly "fixed".)

Why not a blanket OpenCC pass:
  * We use **s2tw**, not s2twp — the "p" (phrases) variant does Taiwan
    *vocabulary* substitution (扩展→擴充套件, 的士→計程車) that mangles this text.
  * Even s2tw "standardises" many already-correct Traditional characters to
    Taiwan variant forms (升→昇, 念→唸, 准→準, 台→臺, 污→汙 …). So we accept a
    change ONLY where the original character is in WHITELIST — characters
    confirmed to be genuine Simplified contamination here. The one-to-many
    merges (里/征/后) rely on s2tw's context (公里 stays 里, 生命里 → 生命裡).

All changes are 1-char→1-char, so any verse `offset` stays valid; a note whose
conversion would change length is left untouched (and reported by the CLI).
"""
from __future__ import annotations

from functools import lru_cache

# Confirmed Simplified characters to fix (A = clearly simplified, B = simplified
# merges verified context-safe in this data). 游 is intentionally excluded: its
# only use here is 游手好閒, where 游 is already valid Traditional.
WHITELIST = set("着于领几羡杠帘柜泄长国须里征后仆余涂")


@lru_cache(maxsize=1)
def _converter():
    from opencc import OpenCC  # imported lazily so the module loads without it

    return OpenCC("s2tw")


def normalize_text(text: str) -> str:
    """Return `text` with whitelisted Simplified characters converted to
    Traditional (context-aware via OpenCC s2tw). Length-preserving; if a
    conversion would change the string length the original is returned."""
    if not text:
        return text
    proposed = _converter().convert(text)
    if len(proposed) != len(text):
        return text
    return "".join(
        conv if (orig != conv and orig in WHITELIST) else orig
        for orig, conv in zip(text, proposed)
    )


# --- CLI: (re)normalise public/annotations.json in place ---------------------


def _main():
    import json
    import sys
    from collections import Counter
    from pathlib import Path

    ann = Path(__file__).resolve().parent.parent / "public" / "annotations.json"
    data = json.loads(ann.read_text(encoding="utf-8"))

    changes: Counter[str] = Counter()
    touched = 0
    total = 0
    for book in data["books"]:
        for chap in book["chapters"]:
            for verse in chap["verses"]:
                for note in verse.get("notes", []):
                    total += 1
                    old = note.get("text", "")
                    new = normalize_text(old)
                    if new != old:
                        note["text"] = new
                        touched += 1
                        changes.update(
                            f"{a}→{b}" for a, b in zip(old, new) if a != b
                        )

    apply = "--apply" in sys.argv
    print(f"掃描 {total} 條註釋；{'將修改' if apply else '預計修改'} {touched} 條")
    for pair, n in changes.most_common():
        print(f"  {pair}: {n}")
    print(f"合計 {sum(changes.values())} 字、{len(changes)} 種")
    if apply:
        ann.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"\n✓ 已寫回 {ann}")
    else:
        print("\n(預覽模式；加 --apply 才會寫回檔案)")


if __name__ == "__main__":
    _main()
