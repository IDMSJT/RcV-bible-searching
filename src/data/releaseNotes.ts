export interface ReleaseNote {
  /** major.minor — patches (the auto commit-count) aren't listed separately. */
  version: string
  date?: string
  notes: string[]
}

// 使用者導向的更新摘要(不是逐筆 commit)。最新的排最前面。
// 新版本發佈時，在最前面加一筆。
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.1',
    date: '2026-06-27',
    notes: [
      '關鍵字搜尋支援異體字',
      '經文多選後，複製 / 分享格式可自訂 (中英文、經文位置、經節寫法)',
      '搜尋分頁可左右滑動切換，複製列固定於底部',
      '平板也支援左右滑動換章',
      '綱要解析增強：支援「中」切段、破折號後的引經、書名縮寫更精準',
      '修正安裝版 App (iOS) 開啟時的捲動位置',
    ],
  },
  {
    version: '1.0',
    date: '2026-06-24',
    notes: [
      '恢復本經文、綱目、註釋閱讀，可左右滑動換章',
      '經節與關鍵字搜尋 (支援中英文)',
      '綱要編排：貼上後自動解析經節引用',
      '註釋可展開，內文引經可點按跳到該節',
      '深色 / 淺色 / 系統主題、字體大小調整',
      '可安裝為 App，離線使用',
    ],
  },
]
