export interface StatsRecord {
  id: number
  date: string
  size: number
}

export function assertValidStatsDraft(draft: StatsRecord): void {
  if (!Number.isSafeInteger(draft.id) || draft.id <= 0) throw new Error('Stats draft id must be a positive safe integer')
  if (
    typeof draft.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(draft.date) ||
    Number.isNaN(Date.parse(draft.date)) ||
    new Date(draft.date).toISOString() !== draft.date
  ) {
    throw new Error('Stats draft date must be a valid ISO UTC timestamp')
  }
  if (!Number.isSafeInteger(draft.size) || draft.size < 0) {
    throw new Error('Stats draft size must be a non-negative safe integer')
  }
}

export function createStatsDraft(history: readonly StatsRecord[], catalogSize: number, now: Date): StatsRecord {
  if (!Number.isSafeInteger(catalogSize) || catalogSize < 0) throw new Error('Catalog size must be a nonnegative integer')
  return {
    id: Math.max(0, ...history.map((record) => record.id)) + 1,
    date: now.toISOString(),
    size: catalogSize,
  }
}
