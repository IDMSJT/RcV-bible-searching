import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Resume the last chapter the user was reading (persisted by __root in
    // localStorage under 'rcv/last-chapter'), so reopening the PWA / hitting `/`
    // lands back where they left off. Fall back to Matthew 1 — the New Testament
    // is the more common entry point for daily reading than 創一 (Genesis 1).
    let bookNo = 40
    let chapterNo = 1
    try {
      const saved = JSON.parse(localStorage.getItem('rcv/last-chapter') ?? 'null')
      const m = typeof saved === 'string' ? saved.match(/^\/(\d+)\/(\d+)/) : null
      if (m) {
        bookNo = Number(m[1])
        chapterNo = Number(m[2])
      }
    } catch {
      /* malformed / unavailable — use the default */
    }
    throw redirect({ to: '/$bookNo/$chapterNo', params: { bookNo, chapterNo } })
  },
})
