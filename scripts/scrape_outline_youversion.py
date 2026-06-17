"""Build the outline (綱目) from the bible.com (YouVersion v4230) edition, using
the cached chapter HTML in cache_yv/ (no network — run scrape_verse_youversion.py
first to populate the cache).

bible.com embeds the outline inline as <div class="s1">…<div class="s4"> headings
interleaved with the verses, so each heading anchors to the next *real* verse
start in document order (precise to the 上/下 切段). The visual class only goes
4 deep; the true 6-level hierarchy is recovered from the marker itself
(壹→1, 一→2, 1→3, a→4, （一）→5, （1）→6). Marker-less section headings
(e.g. 以掃的後代) fall back to the s-class for their level.

Continuation headings are flagged `continued` when either (a) the source carries
a real ─續 / （續） tag, or (b) the exact (marker, title) already appeared earlier
in the same book — bible.com re-prints a heading at the start of each piece of a
disjoint range, and those repeats are continuations.

Output (scripts/output/outline_youversion.json): same shape as outline.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

from scrape_verse_youversion import USFM, CACHE_DIR
from scrape_verse_recoveryversion import BOOK_NAMES

OUTPUT_FILE = Path(__file__).parent / "output" / "outline_youversion.json"

SEP = r"[．.﹒　 ]"
MARKER = (r"（[一二三四五六七八九十百]+）|（\d+）|[壹貳參肆伍陸柒捌玖拾]+"
          r"|[一二三四五六七八九十百]+|\d+|[A-Za-z]")
HEAD_RE = re.compile(rf"^({MARKER}){SEP}+(.*)$")
# A trailing numeric range glued in full-width parens: （24～25）/（1:2b～5）/（36:1～43）
RANGE_RE = re.compile(r"（([\d:：][\d:：a-z～~∼，,－\-\s]*)）\s*$")
LABEL_RE = re.compile(r"^(\d+)([a-z])?$")  # 24 / 2a / 2b
# A real continuation tag — NOT the bare character 續 (so 「…的手續」 is safe).
CONT_TAG_RE = re.compile(r"[（(][^）)]*續[）)]|[─－]\s*續")


def level_from_marker(mk: str) -> int | None:
    if re.fullmatch(r"[壹貳參肆伍陸柒捌玖拾]+", mk):
        return 1
    if re.fullmatch(r"[一二三四五六七八九十百]+", mk):
        return 2
    if re.fullmatch(r"\d+", mk):
        return 3
    if re.fullmatch(r"[A-Za-z]", mk):
        return 4
    if re.fullmatch(r"（[一二三四五六七八九十百]+）", mk):
        return 5
    if re.fullmatch(r"（\d+）", mk):
        return 6
    return None


def is_wrapped(t: str) -> bool:
    """True if the whole string is one parenthesised group (first （ closes at end)."""
    if not (t.startswith("（") and t.endswith("）")):
        return False
    depth = 0
    for i, ch in enumerate(t):
        if ch == "（":
            depth += 1
        elif ch == "）":
            depth -= 1
            if depth == 0:
                return i == len(t) - 1
    return False


def split_heading(text: str) -> tuple[str, str, str, bool]:
    """Return (marker, title, range, continued).

    A heading is a continuation when it carries a ─續 / （續） tag, OR when the
    whole heading is wrapped in （） — bible.com re-prints an ancestor heading
    at a chapter top as a parenthesised breadcrumb (（二﹒以撒的經歷─續）,
    （b﹒成熟的表顯）). Real deep markers like （一）/（1） are NOT fully wrapped
    (their first （ closes after the marker), so they aren't caught here.
    """
    t = text.strip()
    continued = bool(CONT_TAG_RE.search(text)) or is_wrapped(t)
    if is_wrapped(t):  # breadcrumb continuation: （marker﹒title─續）
        t = t[1:-1]
    m = HEAD_RE.match(t)
    marker, rest = (m.group(1), m.group(2)) if m else ("", t)
    rng = ""
    rm = RANGE_RE.search(rest)
    if rm:
        rng = rm.group(1).strip()
        rest = rest[: rm.start()]
    title = re.sub(r"[（(][^）)]*續[）)]\s*$|[─－]\s*續\s*$", "", rest).strip()
    if is_wrapped(title):  # marker-less title still wrapped in （）
        title = title[1:-1]
    return marker, title, rng, continued


def _chapter_events(root, chapter: int) -> list[tuple]:
    """Doc-order events: ('H', text, s-level) and ('V', verse, segment).
    Only verse spans with a real numeric label count (skip trailing fragments)."""
    seq: list[tuple] = []

    def walk(el):
        for c in el.children:
            if getattr(c, "get", None) is None:
                continue
            cl = c.get("class") or []
            slv = next((int(x[1]) for x in cl if x in ("s1", "s2", "s3", "s4")), None)
            if slv:
                seq.append(("H", c.get_text(strip=True), slv))
            elif "verse" in cl and c.get("data-usfm"):
                lab = c.find(class_="label")
                m = LABEL_RE.match(lab.get_text(strip=True)) if lab else None
                if m:
                    seg = (ord(m.group(2)) - ord("a")) if m.group(2) else 0
                    seq.append(("V", int(m.group(1)), seg))
            else:
                walk(c)

    walk(root)
    return seq


def build_chapter(html: str, chapter: int, seen: set) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    root = soup.find(class_="chapter") or soup
    seq = _chapter_events(root, chapter)
    out: list[dict] = []
    for i, e in enumerate(seq):
        if e[0] != "H":
            continue
        nxt = next((x for x in seq[i + 1:] if x[0] == "V"), None)
        marker, title, rng, cont = split_heading(e[1])
        level = (level_from_marker(marker) if marker else None) or e[2]
        # A non-breadcrumb heading repeated at the start of each piece of a
        # disjoint range is a continuation. Match on (marker, title, range), but
        # only when the range is chapter-qualified (has ':') so it's globally
        # unique — a bare verse range like 「20～22」 recurs across chapters as
        # parallel sections (耶利米哀歌 「三 她向耶和華的禱告」) and must not match.
        if ":" in rng or "：" in rng:
            key = (marker, title, rng)
            if key in seen:
                cont = True
            else:
                seen.add(key)
        anchor: dict = {"chapter": chapter}
        if nxt:
            anchor["verse"] = nxt[1]
            if nxt[2] > 0:
                anchor["segment"] = nxt[2]
        entry: dict = {"level": level, "marker": marker, "title": title, "anchor": anchor}
        if rng:
            entry["range"] = rng
        if cont:
            entry["continued"] = True
        out.append(entry)
    return out


def chapters_of(usfm: str) -> list[tuple[int, Path]]:
    out = []
    for p in CACHE_DIR.glob(f"{usfm}.*.html"):
        parts = p.stem.split(".")
        if len(parts) == 2 and parts[0] == usfm and parts[1].isdigit():
            out.append((int(parts[1]), p))
    return sorted(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int, help="single book (1-66)")
    ap.add_argument("--out", type=Path, default=OUTPUT_FILE)
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()

    books = [args.book] if args.book else list(range(1, 67))
    out_books = []
    missing = []
    for bn in books:
        usfm = USFM[bn - 1]
        chapters = chapters_of(usfm)
        if not chapters:
            missing.append(usfm)
            continue
        seen: set = set()
        outline: list[dict] = []
        for ch, path in chapters:
            outline.extend(build_chapter(path.read_text(encoding="utf-8"), ch, seen))
        out_books.append({"bookNo": bn, "name": BOOK_NAMES[bn - 1], "outline": outline})

    data = {"name": "聖經恢復本綱目", "lang": "zh-TW",
            "source": "https://www.bible.com/zh-TW/bible/4230/ (YouVersion v4230)",
            "books": out_books}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    indent = 2 if args.pretty else None
    sep = None if args.pretty else (",", ":")
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=indent, separators=sep),
                        encoding="utf-8")
    n = sum(len(b["outline"]) for b in out_books)
    print(f"Wrote {args.out}: {len(out_books)} books, {n} outline entries")
    if missing:
        print(f"  ! 缺 cache 的書: {missing}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
