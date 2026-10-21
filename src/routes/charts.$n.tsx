import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChartPage } from '@/components/ChartPage'
import { CHARTS } from '@/data/charts'

export const Route = createFileRoute('/charts/$n')({
  loader: ({ params }) => {
    if (!CHARTS.some((c) => String(c.n) === params.n)) throw notFound()
  },
  component: ChartPage,
})
