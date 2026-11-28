import { BOOK_BY_NO } from '@/data/canon'

export const SITE_TITLE = '恢復本聖經查詢'

/** What a route is called: 「加拉太書 4」, 「搜尋」, 「圖表 3」. Used for the browser tab
 * and for analytics, so the two always agree. */
export function pageTitle(pathname: string): string {
  const m = pathname.match(/^\/(\d+)(?:\/(\d+))?/)
  if (m) {
    const book = BOOK_BY_NO.get(Number(m[1]))?.name ?? m[1]
    return m[2] ? `${book} ${m[2]}` : book
  }
  if (pathname === '/search') return '搜尋'
  if (pathname === '/compose') return '綱要'
  if (pathname.startsWith('/charts')) return `圖表 ${pathname.split('/')[2] ?? ''}`.trim()
  return '首頁'
}

/** The browser tab's title: the page, then the app — the app alone on the home page. */
export function documentTitle(pathname: string): string {
  const page = pageTitle(pathname)
  return page === '首頁' ? SITE_TITLE : `${page}｜${SITE_TITLE}`
}
