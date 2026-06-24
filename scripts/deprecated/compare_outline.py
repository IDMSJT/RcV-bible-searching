"""Compare new-site (line.twgbr.org) outline with our outline.json.

The new site marks outline headings as <div class="O0">..<div class="O5">
(6 levels) interleaved with verse <p>s. Heading text is "marker.title　range".
Anchors are resolved by document order (the verse following the heading),
matching how our outline.json was built. Segment-level (上/下) anchoring is our
own enhancement and is not structurally present on the new site, so anchors are
compared at the chapter:verse level.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, Tag

from scrape_verse_twgbr import fetch_book, CHAPTER_TEXT_RE

SCRIPT_DIR = Path(__file__).parent
OUR_OUTLINE = SCRIPT_DIR.parent / "public" / "outline.json"
FW = "　"
OLEVEL_RE = re.compile(r"^O([0-5])$")


def parse_new_outline(html: str) -> list[dict]:
    """Return ordered outline entries: level(1-6), marker, title, range, anchor."""
    soup = BeautifulSoup(html, "lxml")
    events: list[dict] = []
    cur_ch: int | None = None

    for el in soup.find_all(["h3", "div", "p"]):
        if el.name == "h3" and el.get("id", "").startswith("C"):
            m = CHAPTER_TEXT_RE.search(el.get_text())
            cur_ch = int(m.group(1)) if m else 1
        elif el.name == "div" and isinstance(el.get("class"), list):
            cls = el.get("class")[0] if el.get("class") else ""
            mlvl = OLEVEL_RE.match(cls)
            if not mlvl:
                continue
            text = el.get_text(strip=True)
            level = int(mlvl.group(1)) + 1
            marker, title, rng = split_new(text)
            events.append({"type": "outline", "level": level, "marker": marker,
                           "title": title, "range": rng})
        elif el.name == "p" and "calibre2" in (el.get("class") or []) and cur_ch is not None:
            sup = el.find("sup")
            if sup is None:
                continue
            t = sup.get_text().strip()
            mnum = re.match(r"(\d+)", t)
            verse = int(mnum.group(1)) if mnum else 0
            events.append({"type": "verse", "chapter": cur_ch, "verse": verse})

    out: list[dict] = []
    for i, ev in enumerate(events):
        if ev["type"] != "outline":
            continue
        nxt = next((e for e in events[i + 1:] if e["type"] == "verse"), None)
        anchor = {"chapter": nxt["chapter"], "verse": nxt["verse"]} if nxt else {}
        out.append({"level": ev["level"], "marker": ev["marker"],
                    "title": ev["title"], "range": ev["range"], "anchor": anchor})
    return out


def split_new(text: str) -> tuple[str, str, str]:
    """'壹.神的創造　一1～二25' → ('壹', '神的創造', '一1～二25').
    Markers are either '<marker>.' (壹/一/1/a…) or a parenthesised '（一）/（1）'."""
    marker = ""
    mp = re.match(r"^(（[^）]+）)(.+)$", text)  # （一） / （1）
    md = re.match(r"^([^．.]{1,4})[．.](.+)$", text)  # 壹. / 1. / a.
    if mp:
        marker, rest = mp.group(1), mp.group(2)
    elif md:
        marker, rest = md.group(1), md.group(2)
    else:
        rest = text
    if FW in rest:
        title, _, rng = rest.rpartition(FW)
    else:
        title, rng = rest, ""
    return marker.strip(), title.strip(), rng.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", type=int)
    ap.add_argument("--show", type=int, default=40)
    args = ap.parse_args()

    ours = json.loads(OUR_OUTLINE.read_text(encoding="utf-8"))
    ours_by_book = {b["bookNo"]: b for b in ours["books"]}
    books = [args.book] if args.book else list(range(1, 67))

    tot_ours = tot_new = 0
    count_mismatch: list[str] = []
    for bn in books:
        new = parse_new_outline(fetch_book(bn))
        ob = ours_by_book[bn]
        # our outline excluding continuation (續) entries — the new site doesn't repeat those
        our_main = [e for e in ob["outline"] if not e.get("continued")]
        tot_ours += len(our_main)
        tot_new += len(new)
        if len(new) != len(our_main):
            count_mismatch.append(f"{ob['name']}: 我們(非續) {len(our_main)} / 新站 {len(new)}")

    print(f"綱目條目  我們(非續) {tot_ours} / 新站 {tot_new}")
    print(f"\n各卷條目數不一致 ({len(count_mismatch)} 卷):")
    for c in count_mismatch[: args.show]:
        print(f"  {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
