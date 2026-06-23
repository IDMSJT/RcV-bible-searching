# 恢復本聖經查詢 RcV Bible Searching

線上版:https://idmsjt.github.io/RcV-bible-searching/

聖經恢復本(中文)的閱讀、查詢、綱目研讀工具。

## 功能

- **目錄瀏覽**:書卷 → 該書全綱目 → 章節經文
- **章內穿插綱目**:閱讀時 6 層綱目對齊到節/段(上/下)
- **經節查詢**:支援 `約一1` / `創二9` / `約1:1` / `約翰一章一節` / `啟二一9～11` / 跨章換節 / 上下半節 / 異體字書名
- **綱要整理**:貼上綱要,自動列出每點下的引經;解析失敗或查無經節的 token 即時標紅
- **語意標記**:人名(單底線)、地名(單底線)、補字(點底線),資料來自 bible.com YouVersion v4230
- **主題切換**:☀ 淺 / ☾ 深 / ▭ 系統
- **設定**:顯示綱目開關、字體大小

## 開發

```
pnpm install
pnpm dev      # 開發伺服器
pnpm build    # tsc -b && vite build && cp dist/index.html dist/404.html
pnpm lint
```

部署在 GitHub Pages,push 到 `main` 後 GitHub Actions 會自動 build + deploy。

## 架構

- Vite 8 + React 19 + TypeScript 6
- TanStack Router(file-based, autoCodeSplitting)
- Tailwind CSS 4 + shadcn (Base UI)
- 經文/綱目資料以 JSON 形式放在 `public/`,首訪時 fetch 一次,瀏覽器快取

## 授權

恢復本聖經內文版權屬 Living Stream Ministry / 台灣福音書房;本專案僅作個人研讀工具用途。
