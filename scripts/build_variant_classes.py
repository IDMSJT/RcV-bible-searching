#!/usr/bin/env python3
"""build_variant_classes.py — 從 variant_glyphs.json 的候選異體字對，篩出「真.異體字」
等價類，供「搜尋關鍵字時容忍異體字」用。

不靠出現次數(count)判斷,而是用權威來源驗證每一對是不是真的同一個字:

  1. Unicode Unihan 變體欄位(離線、權威):
       強(strong): kZVariant / kSimplifiedVariant / kTraditionalVariant /
                   kCompatibilityVariant  ── 視為「同一個字、不同字形」
       弱(weak)  : kSemanticVariant / kSpecializedSemanticVariant
                   ── 語義變體,較寬;預設不併入,丟進 review 供人工判斷
  2. OpenCC 變體字典(隨 opencc-python-reimplemented 一起裝):
       TWVariants(+Rev) / HKVariants(+Rev) / JPVariants / STCharacters / TSCharacters
       ── 台/港/日 字形 + 簡繁單字,皆視為 strong

流程:
  candidate pair (epub, yv)
    → 任一邊非漢字(標點等)         → review: non-han
    → 在 strong 圖有「直接邊」      → 納入,union-find 成等價類
    → 只在 weak 圖有直接邊          → review: semantic(或 --include-semantic 才併入)
    → 都查不到                      → review: unconfirmed(多半是兩版用字不同)

輸出:
  variant_classes.json  最終等價類 + 每字→類字串 map(app 之後 ship 這份的精簡版)
  variant_review.json   未併入的對,標明原因,供人工檢視

用法:
  cd scripts && . .venv/bin/activate
  python build_variant_classes.py                  # 下載/快取 Unihan 後產出
  python build_variant_classes.py --include-semantic

可重現性:Unihan 版本固定在 UNICODE_VERSION;首次執行會下載 Unihan.zip 抽出
Unihan_Variants.txt 快取到 scripts/cache/unihan/(gitignore),之後離線重跑結果一致。
OpenCC 字典來自已 pin 的 opencc-python-reimplemented(見 requirements.txt)。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

UNICODE_VERSION = "16.0.0"
UNIHAN_URL = f"https://www.unicode.org/Public/{UNICODE_VERSION}/ucd/Unihan.zip"

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "unihan"
GLYPHS = HERE / "variant_glyphs.json"
OUT_CLASSES = HERE / "variant_classes.json"
OUT_REVIEW = HERE / "variant_review.json"
# Generated app-side data: the char→class map the keyword search bundles.
OUT_TS = HERE.parent / "src" / "data" / "variantClasses.ts"

STRONG_FIELDS = {
    "kZVariant",
    "kSimplifiedVariant",
    "kTraditionalVariant",
    "kCompatibilityVariant",
}
WEAK_FIELDS = {"kSemanticVariant", "kSpecializedSemanticVariant"}

OPENCC_FILES = [
    "TWVariants.txt",
    "TWVariantsRev.txt",
    "HKVariants.txt",
    "HKVariantsRev.txt",
    "JPVariants.txt",
    "STCharacters.txt",
    "TSCharacters.txt",
]

# ── Hand curation (reviewed once; see chat / commit message) ───────────────────
# Simplified-collision drops: one simplified glyph was historically split into
# several distinct-meaning traditional chars, so treating them as searchable
# equivalents would over-match (后 queen ≠ 後 after). These are attested variants
# in Unihan/OpenCC, but wrong for *search* — so we exclude them deliberately.
# Whole-class drops (every pair touching the char is removed) + 里 (so 裏/裡 stays
# a class but the distance/village 里 drops out).
COLLISION_DROP_CHARS = set("乾干幹榦係系繫只祇隻周賙週里")
# Two-member collisions: drop just this pair.
COLLISION_DROP_PAIRS = {
    frozenset(p)
    for p in ["后後", "谷穀", "余餘", "云雲", "斗鬥", "征徵", "几幾", "累纍",
              "制製", "卷捲", "准準"]
}
# Semantic variants (Unihan kSemanticVariant only) hand-confirmed as freely
# interchangeable in this text → promoted into the classes. 份/分 excluded on
# purpose (分 is far too common: minute / divide / point).
SEMANTIC_ALLOW = {
    frozenset(p)
    for p in ["預豫", "侖崙", "翦剪", "夠彀", "綫線", "嘆歎", "閙鬧", "鷄雞",
              "喂餧", "熔鎔", "饋餽", "欞櫺", "鎚錘", "綉繡", "仿倣", "鏽銹",
              "覊羈", "舖鋪", "蕩盪", "鍛煅", "饑飢"]
}
# Force-include a corpus pair that's interchangeable in this text but NOT a formal
# Unihan/OpenCC variant, so it'd otherwise fall to 'unconfirmed'. e.g. 什麼/甚麼 —
# 什 and 甚 aren't variants in general, only swapped in this word (text uses 甚麼).
MANUAL_ALLOW = {frozenset(p) for p in ["什甚"]}
# Hand-added equivalence classes that DON'T appear as epub↔yv diffs in the corpus
# (so the candidate loop never sees them), but ARE used interchangeably in the
# text and aren't formally linked in Unihan/OpenCC. Each string is one class.
# e.g. the text mixes 繙 (繙出來) and 翻 (推翻) — the same character historically —
# so typing 翻 should also find the verses spelled 繙.
MANUAL_EXTRA = ["繙翻"]


def log(*a):
    print(*a, file=sys.stderr)


def fetch_unihan_variants() -> str:
    """Download Unihan.zip (pinned version) once, cache Unihan_Variants.txt."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"Unihan_Variants-{UNICODE_VERSION}.txt"
    if cached.exists():
        return cached.read_text(encoding="utf-8")
    log(f"↓ downloading Unihan {UNICODE_VERSION} … {UNIHAN_URL}")
    with urllib.request.urlopen(UNIHAN_URL) as r:  # noqa: S310 (pinned unicode.org URL)
        blob = r.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        txt = z.read("Unihan_Variants.txt").decode("utf-8")
    cached.write_text(txt, encoding="utf-8")
    return txt


def cp_to_char(tok: str):
    """'U+34B9' or 'U+34B9<kMatthews' → the character (annotation stripped)."""
    tok = tok.split("<", 1)[0].strip()
    if not tok.startswith("U+"):
        return None
    try:
        return chr(int(tok[2:], 16))
    except ValueError:
        return None


def parse_unihan(txt: str):
    """Return (strong_edges, weak_edges) as lists of (a, b, source)."""
    strong, weak = [], []
    for line in txt.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        cp, field, value = parts
        if field in STRONG_FIELDS:
            bucket = strong
        elif field in WEAK_FIELDS:
            bucket = weak
        else:
            continue
        a = cp_to_char(cp)
        if a is None:
            continue
        for tok in value.split():
            b = cp_to_char(tok)
            if b and b != a:
                bucket.append((a, b, f"unihan:{field}"))
    return strong, weak


def opencc_dict_dir() -> Path:
    try:
        import opencc
    except ImportError:
        log("✗ 需要 opencc(pip install -r requirements.txt,並在 .venv 中執行)")
        raise
    return Path(os.path.dirname(opencc.__file__)) / "dictionary"


def parse_opencc(d: Path):
    """OpenCC dict line: 'KEY\\tV1 V2 …'. Keep single-char↔single-char edges."""
    edges = []
    for name in OPENCC_FILES:
        p = d / name
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            key, _, rest = line.partition("\t")
            key = key.strip()
            if len(key) != 1:
                continue
            for v in rest.split():
                if len(v) == 1 and v != key:
                    edges.append((key, v, f"opencc:{name[:-4]}"))
    return edges


def build_adj(edges):
    """Undirected adjacency: char -> {neighbour: source}."""
    adj: dict[str, dict[str, str]] = {}
    for a, b, src in edges:
        adj.setdefault(a, {}).setdefault(b, src)
        adj.setdefault(b, {}).setdefault(a, src)
    return adj


def direct_source(adj, a, b):
    """Source label iff a–b are *directly* linked (no transitive chaining, so we
    never merge two chars that only share a component through a third)."""
    return adj.get(a, {}).get(b)


class UnionFind:
    def __init__(self):
        self.parent: dict[str, str] = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def is_han(ch: str) -> bool:
    o = ord(ch)
    return (
        0x4E00 <= o <= 0x9FFF  # CJK Unified
        or 0x3400 <= o <= 0x4DBF  # Ext A
        or 0x20000 <= o <= 0x2A6DF  # Ext B
        or 0xF900 <= o <= 0xFAFF  # Compatibility Ideographs
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--include-semantic",
        action="store_true",
        help="把語義變體(kSemanticVariant 等)也併入等價類,而非只進 review",
    )
    args = ap.parse_args()

    pairs = json.loads(GLYPHS.read_text(encoding="utf-8"))["pairs"]

    uni_strong, uni_weak = parse_unihan(fetch_unihan_variants())
    occ = parse_opencc(opencc_dict_dir())
    strong_adj = build_adj(uni_strong + occ)
    weak_adj = build_adj(uni_weak)

    uf = UnionFind()
    kept, review = [], []
    for p in pairs:
        a, b = p["epub"], p["yv"]
        pair = frozenset((a, b))
        rec = {"epub": a, "yv": b, "count": p["count"], "example": p.get("example")}
        if len(a) != 1 or len(b) != 1 or not (is_han(a) and is_han(b)):
            review.append({**rec, "reason": "non-han", "source": None})
            continue
        if pair in MANUAL_ALLOW:
            kept.append({**rec, "source": "manual"})
            uf.union(a, b)
            continue
        s = direct_source(strong_adj, a, b)
        if s:
            if a in COLLISION_DROP_CHARS or b in COLLISION_DROP_CHARS or pair in COLLISION_DROP_PAIRS:
                review.append({**rec, "reason": "collision", "source": s})
            else:
                kept.append({**rec, "source": s})
                uf.union(a, b)
            continue
        w = direct_source(weak_adj, a, b)
        if w:
            if args.include_semantic or pair in SEMANTIC_ALLOW:
                kept.append({**rec, "source": w})
                uf.union(a, b)
            else:
                review.append({**rec, "reason": "semantic", "source": w})
            continue
        review.append({**rec, "reason": "unconfirmed", "source": None})

    # Hand-added classes that never appeared as corpus diffs.
    for cls in MANUAL_EXTRA:
        chars = list(cls)
        for c in chars[1:]:
            uf.union(chars[0], c)

    # Equivalence classes from the kept (directly-confirmed) pairs.
    members: dict[str, set] = {}
    for ch in list(uf.parent):
        members.setdefault(uf.find(ch), set()).add(ch)
    class_list = sorted("".join(sorted(c)) for c in members.values())
    char_map: dict[str, str] = {}
    for cls in class_list:
        for ch in cls:
            char_map[ch] = cls

    OUT_CLASSES.write_text(
        json.dumps(
            {
                "_comment": (
                    "搜尋容錯用異體字等價類。候選對取自 variant_glyphs.json,"
                    "以 Unihan 變體欄位 + OpenCC 變體字典驗證(非靠 count)。"
                    "重現:python build_variant_classes.py"
                ),
                "unicode_version": UNICODE_VERSION,
                "include_semantic": args.include_semantic,
                "class_count": len(class_list),
                "char_count": len(char_map),
                "classes": class_list,
                "map": char_map,
                "kept": kept,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    OUT_REVIEW.write_text(
        json.dumps(
            {
                "_comment": (
                    "未併入等價類的候選對,供人工檢視。reason: "
                    "collision=Unihan/OpenCC 認定的變體,但屬簡化字碰撞(后/後 等),"
                    "搜尋會過度匹配,故手動排除;"
                    "semantic=只在 Unihan 語義變體欄位且未列入 SEMANTIC_ALLOW;"
                    "unconfirmed=Unihan/OpenCC 都查無(多半兩版用字不同);"
                    "non-han=標點或非單一漢字。"
                ),
                "count": len(review),
                "items": review,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    # Generated TS the app bundles: char → its full equivalence class.
    ts = [
        "// GENERATED by scripts/build_variant_classes.py — do not edit by hand.",
        "// 異體字等價類:每字 → 同類全部字(含自己)。供關鍵字搜尋容錯(搜「吃」也找得到「喫」)。",
        f"// Unicode {UNICODE_VERSION} Unihan 變體欄位 + OpenCC;"
        f"{len(class_list)} 類 / {len(char_map)} 字。",
        "export const VARIANT_CLASS: Record<string, string> = {",
    ]
    for ch in sorted(char_map):
        ts.append(
            f"  {json.dumps(ch, ensure_ascii=False)}: "
            f"{json.dumps(char_map[ch], ensure_ascii=False)},"
        )
    ts.append("}")
    ts.append("")
    OUT_TS.write_text("\n".join(ts), encoding="utf-8")

    rc = Counter(r.get("reason") for r in review)
    log("─" * 48)
    log(f"候選對              : {len(pairs)}")
    log(f"納入等價類          : {len(kept)} 對 → {len(class_list)} 類 / {len(char_map)} 字")
    log(f"review · collision  : {rc['collision']}")
    log(f"review · semantic   : {rc['semantic']}")
    log(f"review · unconfirmed: {rc['unconfirmed']}")
    log(f"review · non-han    : {rc['non-han']}")
    log(f"輸出: {OUT_CLASSES.name} · {OUT_REVIEW.name} · {OUT_TS.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
