#!/usr/bin/env python3
"""Build public/glossary.json — 名詞解釋 drawn from the Recovery Version's own footnotes.

A footnote that opens with 「意，」/「原文意，」… explains the word its marker sits in front of:
創22:14 「…起名叫¹耶和華以勒，…」, note 1 「意，耶和華必豫備，或耶和華必看見。」 So:

  * definition = such a note (its first sentence is what a card shows; the rest is kept too)
  * term       = the text right after the marker: the person / place-name mark that starts
                 there when there is one (exact), else up to the next punctuation.

Same term explained in several places → one entry with every explanation (identical texts merged).
scripts/glossary_overrides.json corrects what the rules get wrong — keyed 「book.ch.v:n」:
  {"term": "…"} to set the term, {"skip": true} to leave the note out.
Run:  cd scripts && python3 build_glossary.py      (stdlib only)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "public" / "glossary.json"
OVERRIDES = HERE / "glossary_overrides.json"

DEF_RE = re.compile(r"^(?:意|原文意|希伯來文意|希臘文意|亞蘭文意|本辭意義是|原文意義是)[，,：:]")
# Some notes give the meaning further in, so the first sentence has to say
# whose meaning it is: the word quoted (太1:21 「“耶穌”是希臘文，…意即耶和華救主」)
# or the name spoken of (伯1:1 「此名的意思是…」). Without one of those, a
# mid-sentence 意即 is usually exegesis, not a definition.
MEANS_RE = re.compile(r"意即|意思是|意為")
NAME_RE = re.compile(r"(?:此名|這名|名字)[^。]{0,6}?(?:意思是|意即|意為|另意|原文意|意，)")
# And anywhere in the note, a quoted word followed by its meaning — 創2:4註3's
# second sentence: 「“耶和華”的意思是“我是那我是，”…」. The word is taken from the
# quotes, and only kept if the verse itself has it (else it's a word from
# elsewhere being discussed), it is short, and it isn't an elided phrase.
QUOTED_RE = re.compile(r"“([^”“]{1,8})”(?:的意思是|意即|的意義是|意為|原文意|，意即|，意思是|，意，)")
QUOTED_MAX = 6
STOP_RE = re.compile(r"[，。；：、！？「」『』（）〔〕“”‘’《》\s]")
MAX_TERM = 10


def first_sentence(text: str) -> str:
    m = re.search(r"。", text)
    return text[: m.end()] if m else text


def quoted_definition(note: str, verse_text: str) -> tuple[str, str] | None:
    """(word, the note from the sentence that defines it on) for QUOTED_RE, or None."""
    sentences = re.split(r"(?<=。)", note)
    for i, sent in enumerate(sentences):
        m = QUOTED_RE.search(sent)
        if not m:
            continue
        word = m.group(1).rstrip("，,")
        if word and len(word) <= QUOTED_MAX and "…" not in word and word in verse_text:
            # A sentence split after 「。」 can start with the 「）」 that closed it.
            return word, "".join(sentences[i:]).strip().lstrip("）)").strip()
    return None


def main() -> int:
    verses: dict[str, dict] = {}
    for b in json.load(open(ROOT / "public/verse.json"))["books"]:
        for c in b["chapters"]:
            for v in c["verses"]:
                verses[f"{b['bookNo']}.{c['chapterNo']}.{v['verse']}"] = v
    notes = json.load(open(ROOT / "public/annotations.json"))["notes"]
    overrides = json.load(open(OVERRIDES)) if OVERRIDES.exists() else {}

    entries: dict[str, dict] = {}
    review: list[dict] = []
    for key, ns in notes.items():
        verse = verses.get(key)
        if not verse:
            continue
        for n in ns:
            ov = overrides.get(f"{key}:{n['n']}", {})
            if ov.get("skip"):
                continue
            off = n["offsets"][0]
            text = verse["text"]
            mark = next(
                (m for m in verse.get("marks", []) if m["s"] == off and m["k"] in ("pn", "png")), None
            )
            if ov.get("term"):
                term, how = ov["term"], "override"
            elif mark:
                term, how = text[mark["s"] : mark["e"]], "mark"
            else:
                term, how = STOP_RE.split(text[off:], maxsplit=1)[0], "punct"
            first = first_sentence(n["text"])
            note_text = n["text"]
            if not (
                DEF_RE.match(n["text"])
                or (f"“{term}”" in first and MEANS_RE.search(first))
                or NAME_RE.search(first)
                or ov.get("term")
            ):
                quoted = quoted_definition(n["text"], text)
                if not quoted:
                    continue
                term, note_text, how = quoted[0], quoted[1], "quoted"
            if not term or len(term) > MAX_TERM:
                review.append({"note": f"{key}:{n['n']}", "term": term, "text": n["text"][:40], "why": "no term"})
                continue
            if how == "punct" and len(term) > 5:
                review.append({"note": f"{key}:{n['n']}", "term": term, "text": n["text"][:40], "why": "long"})
            b, c, v = (int(x) for x in key.split("."))
            e = entries.setdefault(term, {"term": term, "defs": []})
            same = next((d for d in e["defs"] if d["text"] == note_text), None)
            ref = [b, c, v, n["n"]]
            if same:
                same["refs"].append(ref)
            else:
                e["defs"].append({"text": note_text, "refs": [ref]})

    data = {
        "source": "恢復本註解中以「意，」「原文意，」等開頭的名詞解釋，由 scripts/build_glossary.py 產生",
        "entries": sorted(entries.values(), key=lambda e: e["defs"][0]["refs"][0]),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (HERE / "glossary_review.json").write_text(json.dumps(review, ensure_ascii=False, indent=1), encoding="utf-8")
    n_defs = sum(len(e["defs"]) for e in entries.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(entries)} terms, {n_defs} definitions, {OUT.stat().st_size} bytes")
    print(f"review: {len(review)} to look at → scripts/glossary_review.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
