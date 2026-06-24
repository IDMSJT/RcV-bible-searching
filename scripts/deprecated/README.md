# scripts/deprecated — 已過時腳本(僅存查)

舊的資料管線:line.twgbr.org 與 recoveryversion 舊站的經文/綱目爬蟲、`merge_verse.py`
合併器,以及舊→新遷移期用的比對/差異工具。**已被 `../scrape_*_youversion.py` 的
YouVersion 管線取代**,不再維護,也不該拿來覆蓋 `public/`。

- 互相 import 仍可運作(同資料夾);需要現役模組(`scrape_verse_recoveryversion` 等)的
  幾支,檔頭加了 `sys.path.insert(... parent ...)` shim 把上層 `scripts/` 補回路徑。
- 需要 `requests` 等套件(見 `../requirements.txt`)。

詳見 `../README.md`。
