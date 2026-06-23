"""Build outline.json from cached chapter HTML (no network).

Anchoring strategy: outline headings appear in document order immediately
before the verse they head, so each heading anchors to the NEXT verse row
in the DOM. Split verses appear as repeated rows, so a heading sitting
between segments naturally anchors to the correct segment index. The raw
range string (e.g. 一1∼二25) is kept only for display.

Output (scripts/output/outline.json):
    {
      "name": "聖經恢復本綱目",
      "lang": "zh-TW",
      "books": [
        { "bookNo": 1, "name": "創世記", "outline": [
            { "level": 1, "marker": "壹", "title": "神的創造",
              "range": "一1∼二25",
              "anchor": { "chapter": 1, "verse": 1 } },
            { "level": 3, "marker": "3", "title": "神的恢復和進一步的創造",
              "range": "一2下∼二3",
              "anchor": { "chapter": 1, "verse": 2, "segment": 1 } },
            ...
        ] }
      ]
    }
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

from scrape_verse_recoveryversion import BOOK_NAMES, CACHE_DIR, fetch_menu

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "outline.json"
FULLWIDTH_SPACE = "　"

VERSE_LABEL_RE = re.compile(r"^\s*(\d+)\s*:\s*(\d+)\s*$")

# A range glued to the end of a title with no full-width space, e.g.
# 「…亂倫十三1∼22」or「…審斷 二五11∼12」. The range always starts with a
# number-CN chapter (十三/二五/八…) directly followed by an arabic verse, while
# titles end with non-number characters, so this won't eat into the title.
PAIRED_PREFIX = r"(?:撒上|撒下|王上|王下|代上|代下)?"
TRAILING_RANGE_RE = re.compile(
    PAIRED_PREFIX
    + r"[零一二三四五六七八九十百]+\d+[上下]?"
    + r"(?:[，,]\s*\d+[上下]?)*"
    + r"(?:[∼~～]" + PAIRED_PREFIX + r"[零一二三四五六七八九十百]*\d+[上下]?)?$"
)


# Psalms 卷X section headers: "第一至四十一篇指明神的心意…" (the `</BR>` between
# scope and description is dropped by the parser, so split on the 篇 scope).
PSALMS_SCOPE_RE = re.compile(r"^(第[零一二三四五六七八九十百]+至[零一二三四五六七八九十百]+篇)(.+)$")

# A leading section marker followed by a full-width space, used to peel the
# inner marker out of a continuation label like 「（八　進一步的失敗－續）」.
LEADING_MARKER_RE = re.compile(
    r"^([壹貳參肆伍陸柒捌玖拾]+|[一二三四五六七八九十百]+|\d+|[a-zA-Z]|（[^）]+）|卷[一二三四五六七八九十]+)　"
)


def split_text(text: str) -> tuple[str, str]:
    """Split a title-cell string into (title, range)."""
    m = PSALMS_SCOPE_RE.match(text)
    if m:
        return m.group(2), m.group(1)
    if FULLWIDTH_SPACE in text:
        title, _, rng = text.rpartition(FULLWIDTH_SPACE)
        return title, rng
    m = TRAILING_RANGE_RE.search(text)
    if m:
        return text[: m.start()].strip(), m.group(0).strip()
    return text, ""


def split_title_range(title_b) -> tuple[str, str]:
    return split_text(title_b.get_text(strip=True))


def parse_continued(text: str) -> tuple[str, str, str]:
    """Parse a blank-marker continuation label like 「（八　進一步的失敗－續）」
    into (marker, title, range). Marker is '' when none is present."""
    inner = text
    if inner.startswith("（") and inner.endswith("）"):
        inner = inner[1:-1]
    marker = ""
    m = LEADING_MARKER_RE.match(inner)
    if m:
        marker = m.group(1)
        inner = inner[m.end():]
    title, rng = split_text(inner)
    return marker, title, rng


def parse_chapter_outline(html: str, chapter_no: int, warnings: list[str], book_name: str):
    """Return list of outline entries anchored to a (verse, segment) in this chapter."""
    soup = BeautifulSoup(html, "lxml")

    # Build an ordered event stream: verse rows and outline rows, in document order.
    events: list[dict] = []
    seg_counter: dict[int, int] = {}

    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if not tds:
            continue

        # Verse row: first TD is a label like "1:2" with an <A NAME>.
        label_td = tds[0]
        anchor = label_td.find("a", attrs={"name": True})
        if anchor is not None and len(tds) >= 2:
            m = VERSE_LABEL_RE.match(label_td.get_text(strip=True))
            if m and int(m.group(1)) == chapter_no:
                verse_no = int(m.group(2))
                seg = seg_counter.get(verse_no, 0)
                seg_counter[verse_no] = seg + 1
                events.append({"type": "verse", "verse": verse_no, "segment": seg})
                continue

        # Outline row: a TD with a numeric title= attribute holding a bold marker.
        marker_td = next((td for td in tds if td.get("title", "").isdigit()), None)
        if marker_td is None:
            continue
        b = marker_td.find("b")
        if b is None:
            continue
        marker = b.get_text(strip=True)
        title_td = marker_td.find_next_sibling("td")
        if title_td is None:
            continue
        title_b = title_td.find("b")
        if title_b is None:
            continue
        raw = title_b.get_text(strip=True)
        if not raw:
            continue

        continued = False
        if marker:
            title, rng = split_title_range(title_b)
        else:
            # Blank marker = a continuation / parenthetical heading repeated at a
            # chapter top, e.g. 「（八　進一步的失敗－續）」.
            marker, title, rng = parse_continued(raw)
            continued = "續" in raw

        entry = {
            "type": "outline",
            "level": int(marker_td["title"]),
            "marker": marker,
            "title": title,
            "range": rng,
        }
        if continued:
            entry["continued"] = True
        events.append(entry)

    # Resolve each outline heading to the next verse event after it.
    out: list[dict] = []
    for i, ev in enumerate(events):
        if ev["type"] != "outline":
            continue
        nxt = next((e for e in events[i + 1:] if e["type"] == "verse"), None)
        if nxt is None:
            warnings.append(
                f"{book_name} {chapter_no}: 綱目「{ev['title']}」後面沒有經節，錨點略過"
            )
            anchor = {"chapter": chapter_no}
        else:
            anchor = {"chapter": chapter_no, "verse": nxt["verse"]}
            if nxt["segment"] > 0:
                anchor["segment"] = nxt["segment"]
        entry = {
            "level": ev["level"],
            "marker": ev["marker"],
            "title": ev["title"],
            "anchor": anchor,
        }
        if ev["range"]:
            entry["range"] = ev["range"]
        if ev.get("continued"):
            entry["continued"] = True
        out.append(entry)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int, help="single book number (1-66)")
    ap.add_argument("--out", type=Path, default=OUTPUT_FILE)
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()

    menu = fetch_menu()
    warnings: list[str] = []
    books_out: list[dict] = []

    book_range = [args.book] if args.book else list(range(1, 67))
    for book_no in book_range:
        chapter_count = menu[book_no - 1][0]
        name = BOOK_NAMES[book_no - 1]
        outline: list[dict] = []
        for chapter_no in range(1, chapter_count + 1):
            cache_path = CACHE_DIR / f"{book_no:02d}_{chapter_no:03d}.html"
            if not cache_path.exists():
                warnings.append(f"{name} {chapter_no}: cache 缺檔 {cache_path.name}")
                continue
            html = cache_path.read_text(encoding="utf-8")
            outline.extend(parse_chapter_outline(html, chapter_no, warnings, name))
        books_out.append({"bookNo": book_no, "name": name, "outline": outline})

    data = {"name": "聖經恢復本綱目", "lang": "zh-TW", "books": books_out}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.pretty:
        args.out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    n_entries = sum(len(b["outline"]) for b in books_out)
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out} ({size_kb:.1f} KB): {len(books_out)} books, {n_entries} outline entries")
    if warnings:
        print(f"\n{len(warnings)} warnings:")
        for w in warnings[:40]:
            print(f"  ! {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
