#!/usr/bin/env python3
"""Build src/data/homophones.json — for searching by sound when the spelling misses.

A reader who types 別士巴 means 別是巴: 士 and 是 are both shi. So every character is
replaced by one representative of its toneless Mandarin reading (是 士 市 事 … → one
character), the text and the query alike, and the two compared. One character for
one, so a match's position in the folded text is its position in the real text too.

  * readings: Unihan kMandarin (the customary reading comes first — a character with
    several, 行 háng / xíng, keeps that one), pinned to build_variant_classes'
    UNICODE_VERSION and cached in scripts/cache/unihan/.
  * characters: everything in our text, plus the Traditional characters OpenCC knows,
    so a wrong character typed that the Bible never uses still has a reading.
  * tones are ignored: 巴 bā and 罷 bà are the same here. Looser, but a typo is as
    often in the tone as in the character.
  * representative: the reading's most frequent character in our text.

Output `c`: pairs (character, representative), only where they differ.
Run:  cd scripts && .venv/bin/python build_homophones.py
"""
from __future__ import annotations

import io
import json
import re
import sys
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from build_variant_classes import CACHE, UNICODE_VERSION, UNIHAN_URL

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "src" / "data" / "homophones.json"
HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")


def fetch_readings() -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"Unihan_Readings-{UNICODE_VERSION}.txt"
    if cached.exists():
        return cached.read_text(encoding="utf-8")
    print(f"↓ downloading Unihan {UNICODE_VERSION} … {UNIHAN_URL}", file=sys.stderr)
    with urllib.request.urlopen(UNIHAN_URL) as r:  # noqa: S310 (pinned unicode.org URL)
        blob = r.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        txt = z.read("Unihan_Readings.txt").decode("utf-8")
    cached.write_text(txt, encoding="utf-8")
    return txt


def toneless(pinyin: str) -> str:
    s = unicodedata.normalize("NFD", pinyin)
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").replace("ü", "v")


def main() -> int:
    readings: dict[str, str] = {}
    for line in fetch_readings().splitlines():
        if "\tkMandarin\t" not in line:
            continue
        cp, _, value = line.split("\t")
        readings[chr(int(cp[2:], 16))] = toneless(value.split()[0])

    text: list[str] = []
    for b in json.load(open(ROOT / "public/verse.json"))["books"]:
        for c in b["chapters"]:
            text += [v["text"] for v in c["verses"]]
    for notes in json.load(open(ROOT / "public/annotations.json"))["notes"].values():
        text += [n["text"] for n in notes]
    for b in json.load(open(ROOT / "public/outline.json"))["books"]:
        text += [e["title"] for e in b.get("outline") or [] if isinstance(e, dict) and e.get("title")]
    freq = Counter(ch for t in text for ch in t if HAN.match(ch))

    chars = set(freq)
    try:
        import opencc

        d = Path(opencc.__file__).parent / "dictionary"
        for line in (d / "TSCharacters.txt").read_text(encoding="utf-8").splitlines():
            chars.add(line.split("\t", 1)[0])
        for line in (d / "STCharacters.txt").read_text(encoding="utf-8").splitlines():
            chars.update(line.split("\t", 1)[1].split(" "))
    except ImportError:
        print("opencc not installed — only the corpus' own characters get a reading", file=sys.stderr)
    chars = {c for c in chars if len(c) == 1 and HAN.match(c) and c in readings}

    by_sound: dict[str, list[str]] = defaultdict(list)
    for c in chars:
        by_sound[readings[c]].append(c)
    rep = {s: max(cs, key=lambda c: (freq[c], c)) for s, cs in by_sound.items()}
    pairs = sorted((c, rep[readings[c]]) for c in chars if rep[readings[c]] != c)

    missing = [c for c in freq if c not in readings]
    data = {
        "src": f"Unihan {UNICODE_VERSION} kMandarin, toneless; by scripts/build_homophones.py",
        "c": "".join(a + b for a, b in pairs),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {OUT.relative_to(ROOT)}: {len(chars)} characters, {len(by_sound)} readings, "
        f"{OUT.stat().st_size} bytes; corpus characters without a reading: {len(missing)} {''.join(missing[:20])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
