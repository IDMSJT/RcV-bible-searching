#!/usr/bin/env python3
"""gen_icons.py — 從一張方形來源圖產生 PWA 所有尺寸的 icon 到 public/。

用法:
  scripts/.venv/bin/python scripts/gen_icons.py <來源圖.png>

來源建議是 ≥512×512 的正方形。產出(檔名與 vite.config.ts 的 manifest 一致,
換圖只要重跑本腳本即可,不必改設定):
  public/favicon-64x64.png            瀏覽器分頁
  public/apple-touch-icon-180x180.png iOS 主畫面
  public/pwa-192x192.png              Android
  public/pwa-512x512.png              Android / 啟動畫面
  public/maskable-icon-512x512.png    Android 自適應圖示 ← 內容縮到內側 80% 安全區
                                        並以背景色補邊,避免圓形 / squircle 遮罩裁掉
                                        文字或邊角。
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
L = Image.Resampling.LANCZOS


def main():
    if len(sys.argv) != 2:
        sys.exit("用法: python gen_icons.py <來源圖.png>")
    img = Image.open(sys.argv[1]).convert("RGB")
    if img.width != img.height:
        print(f"⚠ 來源非正方形 ({img.width}×{img.height}),會被拉伸", file=sys.stderr)
    bg = img.getpixel((2, 2))  # 角落像素 = 背景色,給 maskable 補邊用

    def resize(size: int, name: str):
        img.resize((size, size), L).save(PUBLIC / name)

    resize(64, "favicon-64x64.png")
    resize(180, "apple-touch-icon-180x180.png")
    resize(192, "pwa-192x192.png")
    resize(512, "pwa-512x512.png")

    # Maskable:把圖縮到內側 80% 安全區,四周以背景色補滿。
    content = int(512 * 0.8)
    canvas = Image.new("RGB", (512, 512), bg)
    off = (512 - content) // 2
    canvas.paste(img.resize((content, content), L), (off, off))
    canvas.save(PUBLIC / "maskable-icon-512x512.png")

    print(f"icons → {PUBLIC}  (背景色 {bg})")


if __name__ == "__main__":
    main()
