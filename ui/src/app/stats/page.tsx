import { Header } from '../../components/common/Header.tsx'
import { StatsPage } from '../../components/stats/StatsPage.tsx'
import StatsStructuredData from '../../components/stats/StatsStructuredData.tsx'
import statsData from '../../data/stats.json' with { type: 'json' }
import type { StatsItem } from '../../schemas/stats.schema.ts'
import { StatsArraySchema } from '../../schemas/stats.schema.ts'

export default function StatsPageRoute() {
  let stats: StatsItem[] = []

  const validationResult = StatsArraySchema.safeParse(statsData)
  if (validationResult.success) {
    stats = validationResult.data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  } else {
    console.error('Invalid stats data format:', validationResult.error)
  }

  const startDate = stats.length > 0 ? stats[0].date : undefined
  const endDate = stats.length > 0 ? stats[stats.length - 1].date : undefined

  return (
    <main className="min-h-screen bg-background">
      <StatsStructuredData endDate={endDate} startDate={startDate} />
      <Header />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="mb-2 font-bold text-3xl">Repositories Statistics</h1>
          <p className="text-muted-foreground">The growth of repositories over time</p>
        </div>

        <StatsPage stats={stats} />
      </div>
    </main>
  )
}
