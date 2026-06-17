import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/$bookNo/$chapterNo', params: { bookNo: 1, chapterNo: 1 } })
  },
})
