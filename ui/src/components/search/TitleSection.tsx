import statsData from '../../data/stats.json' with { type: 'json' }
import { formatDate } from '../../lib/utils.ts'
import { StatsItemSchema } from '../../schemas/stats.schema.ts'

export function TitleSection() {
  const lastUpdated = getLatestStatsDate()

  return (
    <div className="mb-8 space-y-3 text-center">
      <h1 className="mb-2 text-balance font-bold text-2xl sm:text-3xl lg:text-4xl">Awesome Claude Plugins</h1>
      <p className="mx-auto max-w-2xl text-pretty text-muted-foreground text-sm sm:text-base">
        Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows
        {lastUpdated ? `. Last updated: ${lastUpdated}` : ''}
      </p>
    </div>
  )
}

function getLatestStatsDate(): string | null {
  if (!Array.isArray(statsData)) {
    return null
  }

  const latestDate = statsData.reduce<Date | null>((latest, entry) => {
    const validationResult = StatsItemSchema.safeParse(entry)
    if (!validationResult.success) {
      return latest
    }

    const date = new Date(validationResult.data.date)
    if (Number.isNaN(date.getTime()) || (latest && date <= latest)) {
      return latest
    }

    return date
  }, null)

  return latestDate ? formatDate(latestDate) : null
}
