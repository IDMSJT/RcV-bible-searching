import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Land on Matthew 1 — the New Testament is the more common entry point
    // for daily reading than 創一 (Genesis 1).
    throw redirect({ to: '/$bookNo/$chapterNo', params: { bookNo: 40, chapterNo: 1 } })
  },
})
