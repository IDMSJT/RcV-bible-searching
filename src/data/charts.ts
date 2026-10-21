export interface Chart {
  n: number
  name: string
  /** Pixel size of the published WebP — the viewer fits it before it has loaded. */
  w: number
  h: number
  /** Fit the whole chart on screen rather than its short side to the screen — for one with so little on it that the long side is not worth scrolling. */
  contain?: boolean
}

export const CHARTS: Chart[] = [
  { n: 1, name: '舊約時代遠古近東地區', w: 2000, h: 1275 },
  { n: 2, name: '舊約時代的以色列', w: 1274, h: 2000 },
  { n: 3, name: '新約時代的聖地', w: 1273, h: 2000 },
  { n: 4, name: '保羅的行程', w: 2000, h: 1275 },
  { n: 5, name: '神新約的經綸', w: 2000, h: 1275 },
  { n: 6, name: '七十個七與基督來臨並聖徒被提圖', w: 2000, h: 1517 },
  { n: 7, name: '耶穌基督的譜系', w: 744, h: 2000 },
  { n: 8, name: '諸天之國與神的國分別圖', w: 2000, h: 1447 },
  { n: 9, name: '獸的數字', w: 660, h: 2000, contain: true },
]

export function chartSrc(n: number): string {
  return `${import.meta.env.BASE_URL}charts/chart-${String(n).padStart(2, '0')}.webp`
}
