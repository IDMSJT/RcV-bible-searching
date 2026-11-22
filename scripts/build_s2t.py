#!/usr/bin/env python3
"""Build src/data/s2t.json (Simplified→Traditional, for typed input) and src/data/t2s.json
(Traditional→Simplified, for the 繁/簡 display setting) — small tables, retargeted to our text.

Why not ship a whole converter: opencc-js's STPhrases is ~985 KB in one file and costs +457 KB
gzip. What a Bible-outline paste needs is much less, so this builds a table *retargeted to our
own text* (the same idea the interlinear-bible site uses):

  * c — per-character map from OpenCC STCharacters. Where a character has several Traditional
        readings, pick the one this corpus uses most; then fold glyph variants (裡/裏, 着/著 …)
        onto the corpus' dominant member of the variant class (variant_classes.json), so the
        output matches what the app shows (恢復本 writes 裏, not 裡).
  * p — phrases from STPhrases, kept only where (a) the phrase converts differently from the
        per-character result and (b) the Traditional phrase actually occurs in the corpus; plus
        a greedy pass that adds short windows for what a round trip still gets wrong.
  * g — characters that are Simplified-only (never appear in the Traditional corpus). A line is
        converted only if it contains one, so a Traditional line is never touched (皇后, 公里,
        干犯 … are legitimate Traditional and would otherwise be "converted").

Corpus = verse.json + annotations.json + outline.json (+ book names). Evaluation: turn the
corpus into Simplified with OpenCC t2s, convert back with the table, compare — the number is
printed. Run:  cd scripts && .venv/bin/python build_s2t.py   (needs opencc-python-reimplemented)
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "src" / "data" / "s2t.json"
MAX_PHRASE_LEN = 6
GREEDY_MIN_COUNT = int(__import__("os").environ.get("GREEDY_MIN", "10"))  # a corrected window must recur this often to be worth a phrase


def corpus_strings() -> list[str]:
    out: list[str] = []
    for b in json.load(open(ROOT / "public/verse.json"))["books"]:
        for c in b["chapters"]:
            out += [v["text"] for v in c["verses"]]
    for notes in json.load(open(ROOT / "public/annotations.json"))["notes"].values():
        out += [n["text"] for n in notes]
    for b in json.load(open(ROOT / "public/outline.json"))["books"]:
        out.append(b["name"])
        for e in b.get("outline") or []:
            if isinstance(e, dict) and e.get("title"):
                out.append(e["title"])
        if isinstance(b.get("intro"), str):
            out.append(b["intro"])
    canon = (ROOT / "src/data/canon.ts").read_text()
    out += re.findall(r"\['([^']+)',\s*\d+\]", canon)
    return out


def load_opencc_dict(name: str) -> dict[str, list[str]]:
    import opencc

    p = Path(opencc.__file__).parent / "dictionary" / name
    d: dict[str, list[str]] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("\t")
        d[k] = v.split(" ")
    return d


def make_converter(chars: dict[str, str], phrases: dict[str, str]):
    maxlen: dict[str, int] = {}
    for k in phrases:
        maxlen[k[0]] = max(maxlen.get(k[0], 0), len(k))

    def conv(s: str) -> str:
        out, i = [], 0
        while i < len(s):
            ch = s[i]
            n = maxlen.get(ch, 0)
            hit = None
            for ln in range(min(n, len(s) - i), 1, -1):
                v = phrases.get(s[i : i + ln])
                if v is not None:
                    hit = (ln, v)
                    break
            if hit:
                out.append(hit[1])
                i += hit[0]
            else:
                out.append(chars.get(ch, ch))
                i += 1
        return "".join(out)

    return conv


def build_t2s(strings: list[str], freq: Counter, classes: dict[str, str]) -> None:
    """Traditional → Simplified for display. Unlike the other direction nothing needs
    retargeting: OpenCC's TSCharacters + TSPhrases are already small (the phrases are ~5 KB).
    Only extra: the Recovery Version's own glyph variants (裏, 著 …) follow their class siblings.
    Entries that would change a string's length are dropped, so DOM offsets stay valid."""
    from opencc import OpenCC

    tsc = load_opencc_dict("TSCharacters.txt")
    chars = {t: c[0] for t, c in tsc.items() if len(t) == 1 and len(c[0]) == 1 and c[0] != t}
    for ch in classes:
        if ch in chars:
            continue
        sib = next((chars[m] for m in classes[ch] if m in chars and m != ch), None)
        if sib and sib != ch:
            chars[ch] = sib
    base = make_converter(chars, {})
    phrases = {}
    for k, vs in load_opencc_dict("TSPhrases.txt").items():
        v = vs[0]
        if len(k) >= 2 and len(v) == len(k) and v != base(k):
            phrases[k] = v
    conv = make_converter(chars, phrases)
    ref = OpenCC("t2s")
    total = diff = 0
    for s in strings:
        want, got = ref.convert(s), conv(s)
        if len(want) != len(got):
            continue
        for a, b in zip(want, got):
            total += 1
            diff += a != b
    print(f"t2s: chars={len(chars)} phrases={len(phrases)}  differs from OpenCC t2s on {diff}/{total} chars")
    out = ROOT / "src" / "data" / "t2s.json"
    out.write_text(
        json.dumps(
            {
                "src": "OpenCC TSCharacters+TSPhrases (Apache-2.0), glyph variants folded by scripts/build_s2t.py",
                "c": "".join(t + c for t, c in sorted(chars.items())),
                "p": "|".join(f"{k}\t{v}" for k, v in sorted(phrases.items())),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"wrote {out.relative_to(ROOT)}  {out.stat().st_size} bytes")


def main() -> int:
    from opencc import OpenCC

    strings = corpus_strings()
    big = "\n".join(strings)
    freq = Counter(big)
    classes = json.load(open(HERE / "variant_classes.json"))["map"]  # char -> "class string"

    def dominant(ch: str) -> str:
        """Fold a glyph onto the most-used member of its variant class."""
        members = classes.get(ch)
        if not members:
            return ch
        best = max(members, key=lambda m: (freq[m], m == ch))
        return best if freq[best] > freq[ch] else ch

    # --- characters ---------------------------------------------------------
    st = load_opencc_dict("STCharacters.txt")
    chars: dict[str, str] = {}
    for s, cands in st.items():
        if len(s) != 1:
            continue
        best = max(cands, key=lambda c: (freq[c], -cands.index(c)))
        pick = best if freq[best] else cands[0]
        pick = dominant(pick)
        if pick != s:
            chars[s] = pick
    # Glyph variants OpenCC leaves alone because both are valid Traditional (着/著,
    # 裡/裏 …): one the corpus never writes becomes the one it does.
    for ch in classes:
        if ch not in chars and freq[ch] == 0 and dominant(ch) != ch:
            chars[ch] = dominant(ch)

    # --- phrases --------------------------------------------------------------
    stp = load_opencc_dict("STPhrases.txt")
    base = make_converter(chars, {})
    phrases: dict[str, str] = {}
    for k, vs in stp.items():
        if len(k) < 2 or len(k) > MAX_PHRASE_LEN:
            continue
        v = vs[0]
        if v != base(k) and v in big:
            phrases[k] = v
    n_opencc = len(phrases)

    # --- round trip: Traditional corpus -> Simplified (OpenCC t2s) -> table ------
    t2s = OpenCC("t2s")
    pairs: list[tuple[str, str]] = []
    for s in strings:
        simp = t2s.convert(s)
        if len(simp) == len(s):  # compare position by position
            pairs.append((simp, s))

    def evaluate(ph: dict[str, str]):
        conv = make_converter(chars, ph)
        total = bad = 0
        miss: list[tuple[str, str]] = []
        for simp, orig in pairs:
            out = conv(simp)
            if len(out) != len(orig):
                continue
            for i, (a, b) in enumerate(zip(out, orig)):
                total += 1
                if a != b:
                    bad += 1
                    lo, hi = max(0, i - 1), i + 2
                    miss.append((simp[lo:hi], orig[lo:hi]))
        return total, bad, miss

    total, bad, miss = evaluate(phrases)
    print(f"chars={len(chars)}  phrases(from OpenCC)={n_opencc}  round-trip errors {bad}/{total} ({bad / total:.4%})")

    # --- greedy: windows that recur in the misses ------------------------------
    votes: dict[str, Counter] = defaultdict(Counter)
    for w_simp, w_orig in miss:
        if len(w_simp) >= 2:
            votes[w_simp][w_orig] += 1
    added = 0
    for k, c in sorted(votes.items(), key=lambda kv: -sum(kv[1].values())):
        v, n = c.most_common(1)[0]
        if n >= GREEDY_MIN_COUNT and k not in phrases and v != k:
            phrases[k] = v
            added += 1
    total2, bad2, miss2 = evaluate(phrases)
    print(f"+greedy phrases={added}  round-trip errors {bad2}/{total2} ({bad2 / total2:.4%})")
    worst = Counter((a, b) for a, b in miss2).most_common(12)
    print("still wrong (simplified-window → expected):", worst)

    # --- Simplified-only characters (gate) -------------------------------------
    gate = "".join(sorted(s for s, c in chars.items() if freq[s] == 0))

    build_t2s(strings, freq, classes)

    data = {
        "src": "OpenCC STCharacters+STPhrases (Apache-2.0), retargeted to the 恢復本 corpus by scripts/build_s2t.py",
        "g": gate,
        "c": "".join(s + c for s, c in sorted(chars.items())),
        "p": "|".join(f"{k}\t{v}" for k, v in sorted(phrases.items())),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}  {OUT.stat().st_size} bytes; gate chars={len(gate)}, phrases={len(phrases)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
