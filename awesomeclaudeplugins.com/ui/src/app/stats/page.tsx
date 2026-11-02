import { Breadcrumbs } from '../../components/common/Breadcrumbs.tsx'
import { StatsPage } from '../../components/stats/StatsPage.tsx'
import StatsStructuredData from '../../components/stats/StatsStructuredData.tsx'
import { getStatsBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { getStatsHistory } from '../../lib/catalog.ts'
import type { StatsItem } from '../../schemas/stats.schema.ts'

export const dynamic = 'force-dynamic'

export default function StatsPageRoute() {
  const stats: StatsItem[] = getStatsHistory()

  const startDate = stats.length > 0 ? stats[0].date : undefined
  const endDate = stats.length > 0 ? stats[stats.length - 1].date : undefined

  return (
    <main className="bg-background min-h-dvh" id="main-content" tabIndex={-1}>
      <StatsStructuredData endDate={endDate} startDate={startDate} />
      <div className="container mx-auto px-4 py-8">
        <Breadcrumbs items={getStatsBreadcrumbs()} />
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Repository statistics</h1>
          <p className="text-muted-foreground">The growth of repositories over time</p>
        </div>

        <StatsPage stats={stats} />
      </div>
    </main>
  )
}
