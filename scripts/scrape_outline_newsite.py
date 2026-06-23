"""Build outline.json from the line.twgbr.org edition.

Outline headings are <div class="O0">..<div class="O5"> (6 levels), interleaved
with verse <p>s. Heading text is "marker.title　range" (or a parenthesised
「（marker.title─續）」 continuation). Anchors come from document order; the
segment (上/下) is read from the range. Variant characters in titles are
normalised toward the common form.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

from scrape_verse_twgbr import fetch_book, CHAPTER_TEXT_RE
from scrape_verse_recoveryversion import BOOK_NAMES

SCRIPT_DIR = Path(__file__).parent
DEFAULT_OUT = SCRIPT_DIR.parent / "public" / "outline.json"
FW = "　"
OLEVEL_RE = re.compile(r"^O([0-5])$")
VERSE_SUP_RE = re.compile(r"(\d+)")
# range start: optional CN chapter, arabic verse, optional 上/下
RANGE_START_RE = re.compile(r"^[（(]?([零一二三四五六七八九十百]+)?(\d+)([上下])?")

# Normalise only UNAMBIGUOUS single-meaning archaic variants toward the common
# form. Context-dependent pairs (復/複, 了/瞭, 甚/什, 谷/穀, 面/麵…) are left
# untouched because a global replacement would corrupt the other meaning.
NORM_MAP = {
    "─": "－", "～": "∼",
    "衞": "衛", "羣": "群", "啓": "啟", "輭": "軟", "駡": "罵", "寃": "冤",
    "鬪": "鬥", "甎": "磚", "畧": "略", "牀": "床", "傚": "效", "躭": "耽",
    "犂": "犁", "鈎": "鉤", "搾": "榨", "綵": "彩", "盃": "杯", "摀": "捂",
    "餽": "饋", "颺": "揚", "鵰": "雕", "櫺": "欞", "繙": "翻", "鎔": "熔",
}


def normalize(s: str) -> str:
    return "".join(NORM_MAP.get(c, c) for c in s)


def halfwidth(s: str) -> str:
    """Full-width parens → half-width, full-width space → space, and ')(' → ') ('."""
    s = s.replace("（", "(").replace("）", ")").replace("　", " ")
    s = s.replace(")(", ") (")
    return s


# A section marker: capital/CN numerals, arabic, a letter, a parenthesised
# number, or a 卷X. It is followed by '.'/'．', a regular space, or 　.
_MARKER = r"(?:[壹貳參肆伍陸柒捌玖拾]+|[一二三四五六七八九十百]+|\d+|[A-Za-z]|（[^）]+）|卷[一二三四五六七八九十]+)"
HEADING_RE = re.compile(rf"^({_MARKER})[．.　 ](.+)$")


CONT_RE = re.compile(r"[（(][^）)]*續[）)]|[─－]\s*續")  # （續） or ─續
SUFFIX_RE = re.compile(r"[（(][^）)]*續[）)]$|[─－]\s*續$")  # trailing continuation tag
DUP_MARKER_RE = re.compile(r"^([^　]{1,4})　(.+)$")
# a range glued to the end without a full-width space, e.g. 「掌權（續）五十14～26」
TRAIL_RANGE_RE = re.compile(
    r"([零一二三四五六七八九十百]+\d+[上下]?(?:[，,]\d+[上下]?)*"
    r"(?:[～~∼][零一二三四五六七八九十百]*\d+[上下]?)?)$"
)


def split_heading(text: str) -> tuple[str, str, str, bool]:
    """Return (marker, title, range, continued)."""
    continued = bool(CONT_RE.search(text))
    # A parenthesised number marker 「（四）/（1）」 may be followed by the title with
    # no separator.
    pm = re.match(r"^(（[一二三四五六七八九十百\d]+）)[．.　 ]?(.+)$", text)
    m = HEADING_RE.match(text)
    if pm:
        marker, rest = pm.group(1), pm.group(2)
    elif m:
        marker, rest = m.group(1), m.group(2)
    elif text.startswith("（") and text.endswith("）"):
        text = text[1:-1]
        m = HEADING_RE.match(text)
        marker, rest = (m.group(1), m.group(2)) if m else ("", text)
    else:
        marker, rest = "", text
    # some 續 lines repeat the marker ("2.2　活在…（續）"); drop the redundant one
    dm = DUP_MARKER_RE.match(rest)
    if dm and (dm.group(1) == marker or level_from_marker(dm.group(1))):
        rest = dm.group(2)
    if FW in rest:
        title, _, rng = rest.rpartition(FW)
    else:
        tr = TRAIL_RANGE_RE.search(rest)
        if tr:
            title, rng = rest[: tr.start()], tr.group(1)
        else:
            title, rng = rest, ""
    title = SUFFIX_RE.sub("", title).strip()
    return marker.strip(), normalize(title.strip()), rng.strip(), continued


def segment_from_range(rng: str) -> int:
    m = RANGE_START_RE.match(rng)
    if m and m.group(3) == "下":
        return 1
    return 0


def level_from_marker(marker: str) -> int | None:
    if re.fullmatch(r"[壹貳參肆伍陸柒捌玖拾]+", marker):
        return 1
    if re.fullmatch(r"[一二三四五六七八九十百]+", marker):
        return 2
    if re.fullmatch(r"\d+", marker):
        return 3
    if re.fullmatch(r"[A-Za-z]", marker):
        return 4
    if re.fullmatch(r"（[一二三四五六七八九十]+）", marker):
        return 5
    if re.fullmatch(r"（\d+）", marker):
        return 6
    return None


def parse_div(text: str, default_level: int) -> list[tuple[int, str, str, str, bool]]:
    """Return [(level, marker, title, range, continued)]. A breadcrumb div with
    several parenthesised groups (the ancestors continued at a chapter start,
    e.g. 「（三.雅各的經歷）（1　受對付）（b　…─續）」) becomes one entry per group."""
    # A continuation breadcrumb is several 「（…）」 groups joined by 「）（」 (a group
    # may itself contain a nested （…） marker). A normal title that merely contains
    # parens — （約瑟）, （續） — has no top-level 「）（」 boundary.
    if text.startswith("（") and text.endswith("）") and "）（" in text:
        out = []
        for g in text[1:-1].split("）（"):
            marker, title, rng, _ = split_heading(g)
            lvl = level_from_marker(marker) or default_level
            out.append((lvl, marker, title, rng, True))
        return out
    marker, title, rng, continued = split_heading(text)
    return [(default_level, marker, title, rng, continued)]


def parse_book_outline(html: str, book_no: int, chapter_count: int) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    events: list[dict] = []
    cur_ch: int | None = None

    for el in soup.find_all(["h3", "div", "p"]):
        if el.name == "h3" and el.get("id", "").startswith("C"):
            m = CHAPTER_TEXT_RE.search(el.get_text())
            cur_ch = int(m.group(1)) if m else 1
        elif el.name == "div":
            cls = el.get("class") or []
            mlvl = OLEVEL_RE.match(cls[0]) if cls else None
            if not mlvl:
                continue
            text = el.get_text(strip=True)
            if not text:
                continue
            for lvl, marker, title, rng, continued in parse_div(text, int(mlvl.group(1)) + 1):
                events.append({"type": "outline", "level": lvl,
                               "marker": marker, "title": title, "range": rng,
                               "segment": segment_from_range(rng), "continued": continued})
        elif el.name == "p" and "calibre2" in (el.get("class") or []) and cur_ch is not None:
            sup = el.find("sup")
            if sup is None:
                continue
            mnum = VERSE_SUP_RE.match(sup.get_text().strip())
            verse = int(mnum.group(1)) if mnum else 0
            events.append({"type": "verse", "chapter": cur_ch, "verse": verse})

    out: list[dict] = []
    for i, ev in enumerate(events):
        if ev["type"] != "outline":
            continue
        nxt = next((e for e in events[i + 1:] if e["type"] == "verse"), None)
        if nxt is None:
            continue
        anchor = {"chapter": nxt["chapter"], "verse": nxt["verse"]}
        if ev["segment"] > 0:
            anchor["segment"] = ev["segment"]
        entry = {"level": ev["level"], "marker": halfwidth(ev["marker"]),
                 "title": halfwidth(ev["title"]), "anchor": anchor}
        if ev["range"]:
            entry["range"] = halfwidth(ev["range"])
        if ev["continued"]:
            entry["continued"] = True
        out.append(entry)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()

    names = {i + 1: name for i, name in enumerate(BOOK_NAMES)}
    books = [args.book] if args.book else list(range(1, 67))
    out_books = []
    for bn in books:
        outline = parse_book_outline(fetch_book(bn), bn, 0)
        out_books.append({"bookNo": bn, "name": names[bn], "outline": outline})

    data = {"name": "聖經恢復本綱目", "lang": "zh-TW",
            "source": "https://line.twgbr.org/recoveryversion/", "books": out_books}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.pretty:
        args.out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(b["outline"]) for b in out_books)
    print(f"Wrote {args.out}: {len(out_books)} books, {n} outline entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
