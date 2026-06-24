# scripts — 經文 / 綱目 / 註釋資料管線

聖經恢復本資料經爬取、比對後產生 `public/` 下的成品 JSON。需要 `.venv`(見
`requirements.txt`)。腳本檔名以**來源網站**命名。

> **現役管線**(產出 app 實際使用的 `public/*.json`):
> - `public/verse.json` ← `scrape_verse_youversion.py`
> - `public/outline.json` ← `scrape_outline_youversion.py`
> - `public/annotations.json` ← `scrape_annotations.py`(彙整)→
>   `extract_annotations.py`(逐章抽 EPUB 註釋)→ `normalize_simplified.py`(簡轉繁)
> - `public/verse_en.json` ← `build_verse_en.py`
>
> 已過時的舊管線(line.twgbr.org / recoveryversion 舊站 + 遷移期的比對工具)都移到
> **`scripts/deprecated/`**,別拿來覆蓋 `public/`。

## 現役腳本

| 腳本 | 來源 | 產出 | 備註 |
|---|---|---|---|
| `scrape_verse_youversion.py` | bible.com v4230 (YouVersion) | `public/verse.json` | 純經文 + 切段 + pn/png/add 標記;需 headless Chrome。`VERSE_PATCHES` 補回合併節(弗六2-3) |
| `scrape_outline_youversion.py` | bible.com v4230 | `public/outline.json` | 綱目(以 `--out` 指定輸出) |
| `scrape_annotations.py` | (彙整器) | `public/annotations.json` | 跑全本,呼叫 `extract_annotations.extract_chapter`;參數 `nt`/`ot`/`all` |
| `extract_annotations.py` | RcV EPUB | 單章 JSON / 供彙整器呼叫 | 從 EPUB 抽註釋,difflib 把 marker offset 對到 YV 座標,並呼叫 `normalize_text` 簡轉繁 |
| `normalize_simplified.py` | — | 簡轉繁工具 | `normalize_text()`(白名單 + OpenCC s2tw)被 `extract_annotations` import;直接執行可重新正規化既有 `annotations.json`(`--apply` 才寫回) |
| `build_verse_en.py` | — | `public/verse_en.json` | 英文經文 |
| `scrape_verse_recoveryversion.py` | recoveryversion.com.tw | — | verse 爬取已過時,但 `fetch_menu`(各書章/節數)與 `BOOK_NAMES` 仍供現役 youversion 爬蟲使用,故留在現役 |
| `compare_epub_yv.py` | — | `output/…` | EPUB vs YouVersion 比對(驗證 annotations 來源) |

### 簡體正規化
EPUB 來源的註釋夾雜簡體字(主要 `着→著` 4914、`于→於` 1112,共 18 種),
`extract_annotations` 抽取時即經 `normalize_text` 轉成繁體。用 **OpenCC s2tw**
(不用 s2twp — 後者會做台灣*詞彙*替換 `扩展→擴充套件`、`的士→計程車` 弄壞文字)
\+ **白名單**(只轉確認過的簡體字,避免把 `升/念/准/台/污` 等本來正確的繁體異體字
誤改);全為 1:1 替換,不影響 marker `offset`。

`verse.json` / `outline.json` 來自 YouVersion zh-TW,**本來就是繁體、不需正規化**
(其中 `于沙希悉`、`泄撒`、`鄰里`、`天后` 等是合法專名/詞,套正規化反而會弄壞)。

## scripts/deprecated/ — 已過時(僅存查)

舊的 line.twgbr.org / recoveryversion 舊站管線,以及舊→新遷移期的比對工具。已被
YouVersion 管線取代,不再維護(需 `requests` 等套件;import 現役模組靠檔頭 shim 補回
`scripts/`)。

| 腳本 | 原作用 |
|---|---|
| `scrape_verse_twgbr.py` | line.twgbr.org 經文爬蟲(被多個比對工具 import) |
| `merge_verse.py` | recoveryversion + twgbr 合併成舊版 verse.json |
| `scrape_outline.py` | recoveryversion 舊站綱目 |
| `scrape_outline_newsite.py` | line.twgbr.org 綱目 |
| `compare_text.py` · `compare_outline.py` · `compare_youversion.py` · `compare3_variants.py` · `dump_verse_diffs.py` | 新舊資料比對 / 差異分類(異體字、標點、用字) |

## 紀錄文件
- `OUTLINE_ISSUES.md` — 綱目原始資料問題(marker 錯位等)
- `OUTLINE_GAPS.md` — 舊版有、新版無的綱目條目

## 注意
`cache/`、`cache_new/`、`output/`、`.venv/` 皆 gitignore;爬取後 HTML 會快取,重跑
只讀本機檔。`public/*.json` 才是 app 用的成品。
