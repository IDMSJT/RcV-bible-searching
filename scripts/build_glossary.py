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
from collections import Counter, defaultdict
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
MEANS_RE = re.compile(r"意即|意思是|意為|意“")
NAME_RE = re.compile(r"(?:此名|這名|名字)[^。]{0,6}?(?:意思是|意即|意為|另意|原文意|意，)")
# And anywhere in the note, a quoted word followed by its meaning — 創2:4註3's
# second sentence: 「“耶和華”的意思是“我是那我是，”…」. The word is taken from the
# quotes, and only kept if the verse itself has it (else it's a word from
# elsewhere being discussed), it is short, and it isn't an elided phrase.
QUOTED_RE = re.compile(r"“([^”“]{1,8})”(?:的意思是|意即|的意義是|意為|原文意|，意即|，意思是|，意，)")
QUOTED_MAX = 6
# Person and place names (marked pn / png in the verse text) have exact edges,
# so more ways of giving a meaning are safe to read for them:
#   伯利恆 「意即糧食之家。」 迦累得 「希伯來文，意，石堆為證。」 耶書崙 「希伯來文字根意，正直。」
#   迦得 「或許意，幸運。」 耶利米 「意思也許是…」 鹽海 「即死海。」 (an old name glossed by
#   the one readers know), and a name in its own note's sentence with 意即 / 意為
#   (客西馬尼 「客西馬尼意即榨油機。」 希伯來 「…其意為越過，渡過。」).
NAME_START_RE = re.compile(
    r"^(?:或許|也許)?(?:出自)?(?:原文|希伯來文|亞蘭文|希臘文)?(?:字根)?[，,]?意(?:即|為|思是|思也許是)?[，,]?"
)
# 「即…」 glosses an old name with the one readers know (伯拉 即幼發拉底河, 古實 即
# 埃提阿伯). Places only: for a person it says who is meant in that one verse
# (沙龍 即約哈斯), which as a definition would mislead. Not when it points at
# verses (「即16節的…」). The name often runs on into a word the mark leaves out —
# 鹽|海, 希伯來|話, 猶太|教 — so that character comes along.
ALIAS_RE = re.compile(r"^即(?!使)")
ALIAS_SUFFIX = "海河話語教人山地城省"
UNKNOWN_RE = re.compile(r"意不詳|意義不明")
# 「意」 straight into the meaning, no comma — 太10:25 別西卜 「意蒼蠅之王…」, 啟12:9 撒但
# 「原文意對頭」 — but not where 意 begins a word of its own (意志, 意念, 意見 …).
BARE_MEANING_RE = re.compile(r"^(?:原文)?意(?![，,：:即思義志念見願旨向圖欲識味外料])")
# 「X，意，…」「X這名，意思是…」「名叫X，意思是…」 anywhere in any note: X is a
# name when the text right before 意 ends in one. One note can explain several
# (結1:3 「布西，意，可輕視的…；以西結，意，神加強…」).
MEANING_AT_RE = re.compile(r"意(?:，|即|思是|為|“)")
NAME_BEFORE = set("叫為是的，。；：（「“”）」 \n")
NAME_TAIL_RE = re.compile(r"(?:這名|的名字|原文)?[，,]?(?:原文)?$")
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


def names_explained(note: str, names: set[str]) -> list[tuple[str, str]]:
    """(name, note from that name on) for each 「X，意，…」-style meaning in `note`.
    Where a sentence explains several (布西…；以西結…), each stops where the next begins."""
    found: list[tuple[int, str]] = []
    for m in MEANING_AT_RE.finditer(note):
        window = note[max(0, m.start() - 14) : m.start()]
        head = NAME_TAIL_RE.sub("", window)
        for ln in range(min(8, len(head)), 1, -1):
            if head[-ln:] not in names:
                continue
            start = m.start() - (len(window) - len(head)) - ln
            # The name has to start a word: 西亞 is a name, but in 巴路西亞 /
            # 以克利西亞 it's the end of another. Before it: the start, a stop,
            # or 名叫 / 改為 / 是.
            if start == 0 or note[start - 1] in NAME_BEFORE:
                found.append((start, head[-ln:]))
            break
    out: list[tuple[str, str]] = []
    for i, (start, name) in enumerate(found):
        rest = note[start:]
        end = rest.find("。")
        end = len(rest) if end < 0 else end + 1
        if i + 1 < len(found) and found[i + 1][0] < start + end:
            # Up to the next name — and back to where this meaning ends, so the
            # words that lead into the next one go too (「…恩寵，”被改為」).
            seg = note[start : found[i + 1][0]]
            cut = max(seg.rfind(c) for c in "”；，")
            rest = (seg[: cut + 1] if seg[cut] == "”" else seg[:cut]).rstrip("；，、 ")
            rest = (rest[:-2] + "”" if rest.endswith("，”") else rest) + "。"
        elif UNKNOWN_RE.search(rest[:end]):
            continue
        out.append((name, rest))
    return out


# The verse text explains some names itself (mostly the New Testament glossing
# Aramaic): 約1:38 「（拉比繙出來，就是夫子。）」, 可5:41 「大利大古米！（繙出來就是，
# 閨女，我吩咐你起來！）」, 士6:32 「稱基甸為耶路巴力，意思說，…」. Such an entry's
# ref has note 0 — the verse itself.
VERSE_GLOSS = [
    re.compile(r"(?P<term>[^（），。！？：\s]{2,6})繙出來，?就是[，：]?(?P<mean>[^。）]+)"),
    re.compile(r"(?P<term>[^（），。！？：\s]{2,6})！（繙出來就是[，：]?(?P<mean>[^）]+)"),
]
NAMED_GLOSS = re.compile(r"[（，]?(?:他的名字繙出來就是|意思說，)(?P<mean>[^。）]+)")


def verse_definitions(verses: dict[str, dict]) -> list[tuple[str, str, str]]:
    """(verse key, term, explanation) for names the verse text itself explains."""
    out: list[tuple[str, str, str]] = []
    for key, v in verses.items():
        t = v["text"]
        for rx in VERSE_GLOSS:
            for m in rx.finditer(t):
                if "名字" in m["term"]:  # 「他的名字繙出來就是…」 — handled below
                    continue
                mean = m["mean"].strip("，")
                out.append((key, m["term"], f"{m['term']}，就是{mean}{'' if mean[-1] in '！？' else '。'}"))
        # 「X（他的名字繙出來就是…）」 / 「…為X，意思說，…」: X is the name marked just before.
        for m in NAMED_GLOSS.finditer(t):
            mark = next(
                (k for k in v.get("marks", []) if k["k"] in ("pn", "png") and k["e"] in (m.start(), m.start() - 1)),
                None,
            )
            if mark:
                term = t[mark["s"] : mark["e"]]
                out.append((key, term, f"{term}，意思說，{m['mean']}。" if "意思說" in m[0] else f"{term}，就是{m['mean']}。"))
    return out


# Ideas, not names: 舊人, 經綸, 變化, 稱義 … A note defines one with 「X乃是…」「X是…」
# 「X，…是…」「指…」 or by its original word (「希臘文，oikonomia，…意…」). The word's
# edge comes from both sides: the longest start of the verse text at the marker
# that the note itself also uses — 「舊人已經與祂同釘十字架」 at 羅6:6, and the note
# says 舊人, so the word is 舊人. A one-character word (魂, 罪) only when the note
# opens on it (「人的魂是…」), there being no other way to tell.
CONCEPT_PUNCT = re.compile(r"[，。；：、！？「」『』（）“”‘’〔〕\s—]")
NOT_A_WORD_START = set("的了在與和並而就也又是這那我你他她它們之其所把被將對從於向給以及或但都要不必")
CONTEXT_PREFIX = r"(?:這裏的|本節的|此處的|這|人的)?"


def concept_term(text: str, off: int, note: str) -> str:
    best = ""
    for ln in range(2, 9):
        piece = text[off : off + ln]
        if len(piece) < ln or CONCEPT_PUNCT.search(piece):
            break
        if piece in note:
            best = piece
    return "" if not best or best[0] in NOT_A_WORD_START else best


def concept_definition(note: str, term: str) -> list[str]:
    """The note from where it defines `term` on, or None.

    What counts is a sentence saying what the word *is* — 「X乃是…」「X是…」「X就是…」
    「X指…」, or its original word. Not where it comes from or what happens to it:
    「舊人出於亞當，…卻因罪墮落了」 is about 舊人, but doesn't define it. A sentence that
    names the word and defines it wins over a bare 「指…」 opening the note (羅6:6註2:
    「指我們魂裏天然的生命。舊人乃是神所創造而因罪墮落的人…」 → the second first,
    and the 「指…」 kept as an explanation of its own)."""
    t = re.escape(term)
    sentences = re.split(r"(?<=。)", note)
    head = "".join(sentences[:2])
    for i, sent in enumerate(sentences[:2]):
        sent = sent.lstrip("）) ")
        if re.match(CONTEXT_PREFIX + t + r"(?:一辭|這辭)?，?也?(?:乃是|是|就是|乃指|是指|指|即|意即)", sent) or (
            len(term) > 1 and re.match(t + r"，[^。]{0,24}?(?:乃是|是|就是)", sent)
        ):
            found = ["".join(sentences[i:]).strip().lstrip("）) ")]
            if i > 0 and re.match(r"(?:乃)?指(?!著)", note):
                found.append(note)
            return found
    if re.match(r"(?:乃)?指(?!著)", note):
        return [note]
    m = re.match(r"(?:或，[^。]*。)?(?=(?:希臘文|希伯來文|原文)[，,])", note)
    if m and "意" in head:
        return [note[m.end() :]]  # past a leading 「或，計畫。」 to the original word
    return []


def main() -> int:
    verses: dict[str, dict] = {}
    for b in json.load(open(ROOT / "public/verse.json"))["books"]:
        for c in b["chapters"]:
            for v in c["verses"]:
                verses[f"{b['bookNo']}.{c['chapterNo']}.{v['verse']}"] = v
    notes = json.load(open(ROOT / "public/annotations.json"))["notes"]
    overrides = json.load(open(OVERRIDES)) if OVERRIDES.exists() else {}
    names = {
        v["text"][m["s"] : m["e"]]
        for v in verses.values()
        for m in v.get("marks", [])
        if m["k"] in ("pn", "png") and m["e"] - m["s"] >= 2
    }

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
            found: list[tuple[str, str, str]] = []
            if (
                how == "mark"
                and mark["k"] == "png"
                and ALIAS_RE.match(n["text"])
                and not re.search(r"\d節", first)
            ):
                nxt = text[mark["e"] : mark["e"] + 1]
                found.append((term + nxt if nxt and nxt in ALIAS_SUFFIX else term, n["text"], "alias"))
            if how == "mark" and not NAME_RE.search(first):
                # 「他名字的意思是…」 in a later sentence (出31:2 比撒列).
                later = re.split(r"(?<=。)", n["text"])
                hit = next((i for i, x in enumerate(later) if NAME_RE.search(x) or "名字的意思是" in x), None)
                if hit:
                    found.append((term, "".join(later[hit:]).strip().lstrip("）)").strip(), "named-later"))
            if (
                DEF_RE.match(n["text"])
                or (f"“{term}”" in first and MEANS_RE.search(first))
                or NAME_RE.search(first)
                or ov.get("term")
                or (
                    how == "mark"
                    and not UNKNOWN_RE.search(first)
                    and (NAME_START_RE.match(n["text"]) or (term in first and MEANS_RE.search(first)))
                )
            ):
                found.append((term, n["text"], how))
            if not found:
                cterm = term if how == "mark" else concept_term(text, off, n["text"])
                if not cterm and re.match(r"(?:這裏的|本節的|此處的|人的)?" + re.escape(text[off : off + 1]) + r"(?:乃是|是|就是|乃指|指)", n["text"]):
                    cterm = text[off : off + 1]  # one character, named first thing in the note
                if cterm and len(cterm) == 1 and not re.match(r"[\u4e00-\u9fff]", cterm):
                    cterm = ""
                for cdef in concept_definition(n["text"], cterm) if cterm else []:
                    found.append((cterm, cdef, "concept"))
            if not found and BARE_MEANING_RE.match(n["text"]) and not UNKNOWN_RE.search(first):
                # The word: what the verse and the note share (魔鬼的試誘 → 魔鬼), or,
                # when the note doesn't repeat it (別西卜), the verse up to a stop.
                bterm = (concept_term(text, off, n["text"]) if how != "mark" else term) or (
                    term if how == "punct" and len(term) <= 5 else ""
                )
                if bterm:
                    found.append((bterm, n["text"], "meaning"))
            quoted = quoted_definition(n["text"], text)
            if quoted:
                found.append((quoted[0], quoted[1], "quoted"))
            for name, rest in names_explained(n["text"], names):
                found.append((name, rest, "named"))
            dropped = set(ov.get("drop", []))
            seen: set[tuple[str, str]] = set()
            for term, note_text, how in found:
                # The first way a note was read for a word wins, except that one note
                # may give a word two explanations (羅6:6註2 舊人: 「乃是…」 and 「指…」).
                if term in dropped or (term, note_text) in seen or (
                    how != "concept" and any(t == term for t, _ in seen)
                ):
                    continue
                seen.add((term, note_text))
                add(entries, review, key, n, term, note_text, how)

    for key, term, text in verse_definitions(verses):
        add(entries, review, key, {"n": 0, "text": text}, term, text, "verse")

    finish(entries, review, citation_counts(notes))
    return 0


def add(entries: dict, review: list, key: str, n: dict, term: str, note_text: str, how: str) -> None:
    if not term or len(term) > MAX_TERM:
        review.append({"note": f"{key}:{n['n']}", "term": term, "text": n["text"][:40], "why": "no term"})
        return
    if how == "punct" and len(term) > 5:
        review.append({"note": f"{key}:{n['n']}", "term": term, "text": n["text"][:40], "why": "long"})
    # The card shows the first sentence; the whole note is a tap away on its
    # link. Keeping only that sentence keeps the file a fraction of the size.
    note_text = first_sentence(note_text)
    b, c, v = (int(x) for x in key.split("."))
    e = entries.setdefault(term, {"term": term, "defs": []})
    same = next((d for d in e["defs"] if d["text"] == note_text), None)
    ref = [b, c, v, n["n"]]
    if same:
        same["refs"].append(ref)
    else:
        e["defs"].append({"text": note_text, "refs": [ref]})



CN_DIGITS = "零一二三四五六七八九"


def chinese_number(n: int) -> str:
    """Chapter numbers the way the notes write them: 14 → 十四, 119 → 一百一十九."""
    if n < 10:
        return CN_DIGITS[n]
    if n < 20:
        return "十" + (CN_DIGITS[n % 10] if n % 10 else "")
    if n < 100:
        return CN_DIGITS[n // 10] + "十" + (CN_DIGITS[n % 10] if n % 10 else "")
    h, r = divmod(n, 100)
    if r == 0:
        return CN_DIGITS[h] + "百"
    if r < 10:
        return CN_DIGITS[h] + "百零" + CN_DIGITS[r]
    return CN_DIGITS[h] + "百" + chinese_number(r) if r >= 20 else CN_DIGITS[h] + "百一十" + (CN_DIGITS[r % 10] if r % 10 else "")


def citation_counts(notes: dict) -> Counter:
    """How often other notes point at each note — 「見約一14註4」, or 「見一14註4」 from
    within the same book. A note others keep sending the reader to is the one that
    says it best: 恩典 → 約1:14註4, 經綸 → 提前1:4註4."""
    abbrev = {int(k): v for k, v in re.findall(r"(\d+):\s*'([^']+)'", (ROOT / "src/data/abbrev.ts").read_text())}
    by_book: dict[int, list[str]] = defaultdict(list)
    for key, ns in notes.items():
        by_book[int(key.split(".")[0])] += [n["text"] for n in ns]
    everything = "\n".join(t for ts in by_book.values() for t in ts)
    counts: Counter = Counter()
    for key, ns in notes.items():
        b, c, v = (int(x) for x in key.split("."))
        same_book = "\n".join(by_book[b])
        for n in ns:
            tail = f"{chinese_number(c)}{v}註{n['n']}"
            full = everything.count(f"{abbrev.get(b, '?')}{tail}")
            short = len(re.findall(r"(?<=[見與，、；（])" + tail + r"(?!\d)", same_book))
            counts[(b, c, v, n["n"])] = full + short
    return counts


def finish(entries: dict, review: list, cites: Counter) -> None:
    # Order within a word: a general definition (「恩典是…」) before what it means in
    # one verse (「這裏的恩典指…」, or a bare 「指…」 — 盼望 「指盼望獲釋出獄…」); then
    # the note other notes cite most; then canonical order.
    for e in entries.values():
        e["defs"].sort(
            key=lambda d: (
                bool(re.match(r"這裏|本節|此處|(?:乃)?指", d["text"])),
                -max(cites[tuple(r)] for r in d["refs"]),
                d["refs"][0],
            )
        )
    data = {
        "source": "恢復本註解中以「意，」「原文意，」等開頭的名詞解釋，由 scripts/build_glossary.py 產生",
        "entries": sorted(entries.values(), key=lambda e: e["defs"][0]["refs"][0]),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (HERE / "glossary_review.json").write_text(json.dumps(review, ensure_ascii=False, indent=1), encoding="utf-8")
    n_defs = sum(len(e["defs"]) for e in entries.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(entries)} terms, {n_defs} definitions, {OUT.stat().st_size} bytes")
    print(f"review: {len(review)} to look at → scripts/glossary_review.json")


if __name__ == "__main__":
    sys.exit(main())
