export const ITEMS_PER_BATCH = 24

export function getResetVisibleCount(batchSize: number = ITEMS_PER_BATCH): number {
  return batchSize
}

export function getExpandedVisibleCount(
  currentVisibleCount: number,
  totalItems: number,
  batchSize: number = ITEMS_PER_BATCH
): number {
  return Math.min(currentVisibleCount + batchSize, totalItems)
}

export function getRenderedItemCount(visibleCount: number, totalItems: number): number {
  return Math.min(visibleCount, totalItems)
}
