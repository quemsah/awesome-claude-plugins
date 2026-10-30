import { expect, it } from 'vitest'
import { isPluginSummaries, parsePluginSummariesJson } from './pluginSummaries.js'

it('accepts empty arrays and summaries at their UTF-16 bounds', () => {
  expect(isPluginSummaries([])).toBe(true)
  expect(
    isPluginSummaries([{ name: 'n'.repeat(160), description: 'd'.repeat(300) }, ...Array.from({ length: 29 }, () => ({ name: 'plugin' }))]),
  ).toBe(true)
})

it.each([
  ['more than 30 summaries', Array.from({ length: 31 }, () => ({ name: 'plugin' }))],
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
