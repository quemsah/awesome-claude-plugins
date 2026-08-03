import { StatsItemSchema } from '../schemas/stats.schema.ts'

export const FALLBACK_LAST_MODIFIED = new Date('2026-01-01T00:00:00.000Z')

export function getLatestValidStatsDate(entries: readonly unknown[]): Date {
  const latestDate = entries.reduce<Date | null>((latest, entry) => {
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

  return latestDate ?? FALLBACK_LAST_MODIFIED
}
