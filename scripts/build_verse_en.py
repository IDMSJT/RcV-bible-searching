"""Extract the English Recovery Version verse text from the bilingual DB that
came with the friend's single-HTML RcV bible app (saved in scripts/sources/
during the framework migration) and write it as `public/verse_en.json` in the
same shape as `verse.json` so the existing data loader can fetch it directly.

Each verse becomes `{verse, text}` with the English string only. Verses that
the friend's DB does not have are simply absent — the UI falls back to "no
English" gracefully.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
FRIEND_DB = SCRIPT_DIR / "sources" / "rcv_friend_db.json"
OUT = SCRIPT_DIR.parent / "public" / "verse_en.json"

# 12 verses the friend's DB left with a blank English string (so the loop below
# skips them). Backfilled from the lightinnj.org RcV bilingual pages and checked
# verse-by-verse against the Chinese (see compare_verse_en_lightinnj.py). Keyed
# (bookNo, chapter, verse). Two other lightinnj-only rows were intentionally NOT
# taken: 代上21:31 (our 22:1 under a different versification) and 約叁1:15 (whose
# lightinnj text is actually Jude 1:1).
EN_PATCHES: dict[tuple[int, int, int], str] = {
    (1, 24, 30): "As soon as he had seen the ring and the bracelets upon his sister's hands, and had heard the words of Rebekah his sister, saying, This is what the man spoke to me, he went to the man. And there he was, standing by the camels at the spring.",
    (3, 1, 14): "And if his offering to Jehovah is a burnt offering of birds, then he shall present his offering of turtledoves or of young pigeons.",
    (6, 4, 14): "On that day Jehovah magnified Joshua in the sight of all Israel, and they revered him as they had revered Moses all the days of his life.",
    (9, 23, 26): "And Saul went on one side of the mountain, while David and his men went on the other side of the mountain. And David hurried to get away from Saul, while Saul and his men were closing in on David and his men in order to capture them.",
    (11, 6, 33): "So also he made for the entrance of the temple doorposts of olive wood, out of a fourth of the breadth of the wall,",
    (11, 10, 24): "And all the earth sought the presence of Solomon to hear his wisdom, which God had put in his heart.",
    (11, 12, 32): "And Jeroboam ordained a feast in the eighth month, on the fifteenth day of the month, like the feast that is in Judah, and he went up to the altar; he did likewise at Bethel, sacrificing to the calves that he had made. And he placed in Bethel the priests of the high places that he had made.",
    (11, 20, 27): "And the children of Israel were numbered and supplied with food, and they went to meet them. And the children of Israel encamped before them like two little flocks of goats, but the Syrians filled the land.",
    (12, 5, 25): "And he went in and stood before his master. And Elisha said to him, Where have you come from, Gehazi? And he said, Your servant has not gone anywhere.",
    (20, 5, 21): "For the ways of a man are before the eyes of Jehovah, And He ponders all his paths.",
    (51, 4, 18): "The greeting in my own hand -- Paul. Remember my bonds. Grace be with you.",
    (58, 9, 1): "Now then the first covenant also had ordinances of service, and its sanctuary was of this world.",
}


def main() -> int:
    if not FRIEND_DB.exists():
        print(f"missing {FRIEND_DB}", file=sys.stderr)
        return 1
    db = json.loads(FRIEND_DB.read_text(encoding="utf-8"))

    books = []
    n_verses = 0
    for i, abbr in enumerate(db["abbrs"]):
        bk = db["db"].get(abbr, {})
        chapters = []
        for ch_str in sorted(bk, key=int):
            verses_obj = bk[ch_str]
            verses = []
            for v_str in sorted(verses_obj, key=int):
                pair = verses_obj[v_str]
                en = pair[1] if len(pair) > 1 else ""
                if not en:
                    continue
                verses.append({"verse": int(v_str), "text": en})
                n_verses += 1
            if verses:
                chapters.append({"chapterNo": int(ch_str), "verses": verses})
        books.append({"bookNo": i + 1, "name": db["enFull"][i], "chapters": chapters})

    # Backfill the blank-English verses, inserting each in verse order.
    by_no = {b["bookNo"]: b for b in books}
    for (bn, cn, vn), text in EN_PATCHES.items():
        chapters_by_no = {c["chapterNo"]: c for c in by_no[bn]["chapters"]}
        verses = chapters_by_no[cn]["verses"]
        if any(x["verse"] == vn for x in verses):
            continue
        verses.append({"verse": vn, "text": text})
        verses.sort(key=lambda x: x["verse"])
        n_verses += 1

    data = {
        "name": "Recovery Version (English)",
        "lang": "en",
        "source": "Living Stream Ministry; extracted from RcV bilingual HTML",
        "books": books,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"Wrote {OUT} ({size_mb:.2f} MB): {len(books)} books, {n_verses} verses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
