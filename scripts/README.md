# scripts — 經文與綱目資料管線

聖經恢復本資料經爬取、比對後產生 `public/verse.json` 與 `public/outline.json`。
需要 `.venv`(見 `requirements.txt`)。腳本檔名以**來源網站**命名。

> **現役管線**：`public/verse.json` 由 `scrape_verse_youversion.py` 產出,
> `public/outline.json` 由 `scrape_outline_newsite.py` 產出。其餘 verse/outline
> 腳本若標 **⚠️ 已過時** 即非現役(早期評估 / 比對用),別拿來覆蓋 public/。

## 經文爬蟲(每個檔對應一個來源網站)

| 腳本 | 來源網站 | 產出 | 備註 |
|---|---|---|---|
| `scrape_verse_youversion.py` | bible.com v4230 (YouVersion) | **`public/verse.json`(現役)** | 純經文 + 切段 + pn/png/add 標記；需 headless Chrome。`VERSE_PATCHES` 補回合併節(弗六2-3) |
| `scrape_verse_recoveryversion.py` | recoveryversion.com.tw | `output/verse_old.json` | 仍被引用：`fetch_menu`(各書章數)供現役爬蟲使用 |
| `scrape_verse_twgbr.py` | line.twgbr.org | (供 merge / newsite outline 讀) | 仍被 `scrape_outline_newsite.py` import |
| `merge_verse.py` | recoveryversion + twgbr | ~~`public/verse.json`~~ | **⚠️ 已過時** — 被 youversion 取代 |

註釋(footnotes)另由 `scrape_annotations.py` → `extract_annotations.py` 從 EPUB
產出 `public/annotations.json`；英文經文由 `build_verse_en.py` 產 `public/verse_en.json`。

## 綱目腳本

| 腳本 | 作用 | 產出 |
|---|---|---|
| `scrape_outline_newsite.py` | 從新站解析綱目(**現役**) | `public/outline.json` |
| `scrape_outline.py` | 舊站版本 | `output/outline_old.json` ⚠️ 已過時 |
| `scrape_outline_youversion.py` | bible.com 綱目(評估用,未採用) | `output/outline_youversion.json` ⚠️ 已過時 |

## 比對 / 診斷工具

- `compare_text.py` — 新舊經文比對,分類 variant/punct/wording → `output/cmp_*.txt`
- `compare_youversion.py` — bible.com(YouVersion)vs 目前成品 verse.json 比對 → `output/cmp_yv_*.txt`
- `dump_verse_diffs.py` — 新舊經文差異輸出,分三類(異體字 / 標點引號 / 用字遣詞)→ `output/verse_diffs.txt`
- `compare_outline.py` — 新舊綱目比對
- `explore_outline.py`、`scan_continued.py` — 一次性結構探查(開發用)

## 紀錄文件

- `OUTLINE_ISSUES.md` — 綱目原始資料問題(marker 錯位等)
- `OUTLINE_GAPS.md` — 舊版有、新版無的綱目條目(待補,決定全補)

## 注意

`cache/`、`cache_new/`、`output/`、`.venv/` 皆 gitignore；爬取後的 HTML 會快取,
重跑只讀本機檔。`public/verse.json`、`public/outline.json` 才是 app 用的成品。
