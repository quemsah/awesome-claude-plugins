import { expect, it } from 'vitest'
import { isPluginSummaries, MAX_PLUGIN_SUMMARIES, parsePluginSummariesJson, serializePluginSummaries } from './pluginSummaries.js'

it('accepts empty arrays and summaries at their UTF-16 bounds', () => {
  expect(isPluginSummaries([])).toBe(true)
  expect(
    isPluginSummaries([{ name: 'n'.repeat(160), description: 'd'.repeat(300) }, ...Array.from({ length: 29 }, () => ({ name: 'plugin' }))]),
  ).toBe(true)
})

it('accepts collections from 31 to 500 elements', () => {
  const collection31 = Array.from({ length: 31 }, (_, index) => ({ name: `plugin-${index + 1}` }))
  expect(isPluginSummaries(collection31)).toBe(true)
  expect(parsePluginSummariesJson(JSON.stringify(collection31))).toHaveLength(31)

  const collection300 = Array.from({ length: 300 }, (_, index) => ({
    name: `plugin-${index + 1}`,
    description: `description-${index + 1}`,
  }))
  expect(isPluginSummaries(collection300)).toBe(true)
  expect(parsePluginSummariesJson(JSON.stringify(collection300))).toHaveLength(300)

  const collection500 = [
    { name: 'n'.repeat(160), description: 'd'.repeat(300) },
    ...Array.from({ length: MAX_PLUGIN_SUMMARIES - 1 }, (_, index) => ({ name: `plugin-${index + 2}` })),
  ]
  expect(isPluginSummaries(collection500)).toBe(true)
  expect(parsePluginSummariesJson(JSON.stringify(collection500))).toHaveLength(500)
})

it('serializes up to 500 summaries and breaks on exceeding collections', () => {
  const items = Array.from({ length: 600 }, (_, index) => ({
    name: `plugin-${index + 1}`,
    description: `description-${index + 1}`,
  }))
  const serialized = serializePluginSummaries(items)
  const parsed = parsePluginSummariesJson(serialized)
  expect(parsed).not.toBeNull()
  expect(parsed).toHaveLength(500)
  expect(parsed?.[0]?.name).toBe('plugin-1')
  expect(parsed?.[30]?.name).toBe('plugin-31')
  expect(parsed?.[499]?.name).toBe('plugin-500')
})

it.each([
  ['more than 500 summaries', Array.from({ length: 501 }, () => ({ name: 'plugin' }))],
  ['an empty summary', [{}]],
  ['an unexpected key', [{ name: 'plugin', source: './plugin' }]],
  ['a non-string field', [{ description: 5 }]],
  ['an oversized name', [{ name: 'n'.repeat(161) }]],
  ['an oversized description', [{ description: 'd'.repeat(301) }]],
  ['an unmatched high surrogate', [{ name: `bad${'\ud800'}` }]],
  ['an unmatched low surrogate', [{ description: `bad${'\udc00'}` }]],
])('rejects %s', (_label, summaries) => {
  expect(isPluginSummaries(summaries)).toBe(false)
  expect(parsePluginSummariesJson(JSON.stringify(summaries))).toBeNull()
})

it('rejects malformed JSON while parsing cached summaries', () => {
  expect(parsePluginSummariesJson('{"plugins":[')).toBeNull()
})

it('persists display names without truncating valid large marketplaces', () => {
  const items = Array.from({ length: 75 }, (_, index) => ({
    name: `canonical-${index}`,
    displayName: index === 0 ? 'Human Readable Plugin' : index === 1 ? '   ' : undefined,
    description: `Description ${index}`,
  }))
  const parsed = parsePluginSummariesJson(serializePluginSummaries(items))
  expect(parsed).toHaveLength(75)
  expect(parsed?.[0]).toEqual({ name: 'Human Readable Plugin', description: 'Description 0' })
  expect(parsed?.[1]).toEqual({ name: 'canonical-1', description: 'Description 1' })
  expect(parsed?.[74]?.name).toBe('canonical-74')
})
