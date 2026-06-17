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
