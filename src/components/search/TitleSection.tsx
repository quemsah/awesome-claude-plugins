import statsData from '../../data/stats.json' with { type: 'json' }
import { formatDate } from '../../lib/utils.ts'
import { StatsItemSchema } from '../../schemas/stats.schema.ts'

export function TitleSection() {
  let lastUpdated: string | null = null

  if (Array.isArray(statsData) && statsData.length > 0) {
    const lastEntryRaw = statsData[statsData.length - 1]
    const validationResult = StatsItemSchema.safeParse(lastEntryRaw)

    if (validationResult.success) {
      const date = new Date(validationResult.data.date)
      lastUpdated = formatDate(date)
    }
  }

  return (
    <div className="mb-8 space-y-2 text-center">
      <h1 className="mb-2 font-bold text-3xl">Awesome Claude Plugins</h1>
      <p className="text-muted-foreground">
        Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows
        {lastUpdated ? `. Last updated: ${lastUpdated}` : ''}
      </p>
    </div>
  )
}
