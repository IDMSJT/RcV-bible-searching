# 功能待補

還沒做、還沒決定,或做了一半的事。做完就從這裡刪掉,不用留紀錄——那是 git log 的工作。

舊版 = 朋友的單檔靜態版(`index.html`,現仍部署在 GitHub Pages legacy)。

## 舊版有、新版缺

| 功能 | 舊版行為 | 工程量 | 備註 |
|---|---|---|---|
| **關鍵字搜尋:新舊約篩選** | 下拉:全部 / 只舊約 / 只新約 | 小 | `searchKeyword` 加一個參數,依 bookNo ≤39 / ≥40 過濾;LookupPanel 關鍵字 tab 加控制項 |
| **綱目匯出 DOCX** | 「輸出 DOCX」按鈕 | 中 | 需加 `docx` 套件。PDF 已有 `window.print()` 另存,堪用 |
| **綱目樣式切換** | 卡片式 / 同章合併 | 小–中 | 目前固定一種版面 |

## 做了一半

- **英文書名只認 RcV 縮寫** — `John 1:1`、`Gen. 1:1`、`1 Cor 13:4` 可以;全名 `Genesis 1:1` 和別家縮寫 `Ps 23:1`(RcV 寫 `Psa`)不行。要補就在 `BOOK_ABBREV_EN` 之外再加一張全名/常見縮寫表。
- **章層級引經無法連結** — 串珠裡有 34 處指的是整章(最長 詩篇11～32,共 307 節),`VerseRef` 沒有「整章」這個表示法,所以不連。要做得先決定預覽怎麼呈現——compose 的 `COLLAPSE_OVER = 12` 是現成的先例。
- **死碼** — `ChapterView.tsx:599` 和 `__root.tsx:153` 去清 `[data-scroll-restoration-id="main"]` 的捲動位置,但閱讀頁自己捲動的是 panel,不是那個元素。確認後刪掉。

## 待決

- **英文經文來源** — `public/verse_en.json` 整份出自 bibleread.online,而水流職事站把該站列在侵權名單上。`scripts/build_verse_en_bibleread.py` 的檔頭和當初的 commit 訊息都寫成「官方」,是錯的。要決定留、換回舊版、還是另找來源;1.3 的更新說明因此沒提這件事。
- **節次 highlight 在手機上左邊沒有留白** — 桌機看不出來。推測是數字欄 `minmax(1.3125em, auto)` 剛好被兩位數填滿,底色的 `px-1 -mx-1` 只能往頁面 `px-4` 溢出;但還沒在真機上量過,量到再改。

## 暫緩

- **綱目簡→繁** — 輸入簡體、輸出繁體(s2tw 不換詞)。opencc-js 的 STPhrases 字典 985K(+457 KB gzip)無法 tree-shake;若做,走 lazy-load + 從 PWA precache 排除。
- **生命讀經** — `life-study` branch(8 個 commit,只在本地)。卡在版權:水流職事站的條款禁止下載(明文含個人使用)與電子再散布,引用上限是完整著作的 50%,而一篇生命讀經本身就是一個完整單位。
