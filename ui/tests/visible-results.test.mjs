import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getExpandedVisibleCount, getRenderedItemCount, getResetVisibleCount, ITEMS_PER_BATCH } from '../src/lib/visibleResults.mjs'

describe('visible result window', () => {
  it('expands by one batch when more results are observed', () => {
    assert.equal(getExpandedVisibleCount(ITEMS_PER_BATCH, 100), ITEMS_PER_BATCH * 2)
  })

  it('resets to the first batch after a result set change', () => {
    const visibleAfterScroll = getExpandedVisibleCount(ITEMS_PER_BATCH * 2, 100)
    assert.equal(visibleAfterScroll, ITEMS_PER_BATCH * 3)

    const visibleAfterSearch = getResetVisibleCount()
    assert.equal(visibleAfterSearch, ITEMS_PER_BATCH)
  })

  it('keeps rendered cards consistent when filtering below one batch', () => {
    const filteredResultCount = 7
    const visibleAfterSearch = getResetVisibleCount()

    assert.equal(getRenderedItemCount(visibleAfterSearch, filteredResultCount), filteredResultCount)
  })
})
