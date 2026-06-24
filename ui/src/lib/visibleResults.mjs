export const ITEMS_PER_BATCH = 24

export function getResetVisibleCount(batchSize = ITEMS_PER_BATCH) {
  return batchSize
}

export function getExpandedVisibleCount(currentVisibleCount, totalItems, batchSize = ITEMS_PER_BATCH) {
  return Math.min(currentVisibleCount + batchSize, totalItems)
}

export function getRenderedItemCount(visibleCount, totalItems) {
  return Math.min(visibleCount, totalItems)
}
