export const repositorySearchQueryVersion = 2

export type RepositorySearchQuery = {
  queryId: string
  queryText: string
  lane: 'metadata' | 'readme' | 'topic'
}

export const repositorySearchQueries: readonly RepositorySearchQuery[] = [
  { queryId: 'topic_claude_plugin', queryText: 'topic:claude-plugin is:public', lane: 'topic' },
  { queryId: 'topic_claude_code_marketplace', queryText: 'topic:claude-code-marketplace is:public', lane: 'topic' },
  { queryId: 'topic_claude_code_plugins', queryText: 'topic:claude-code-plugins is:public', lane: 'topic' },
  { queryId: 'topic_claude_code_plugin', queryText: 'topic:claude-code-plugin is:public', lane: 'topic' },
  { queryId: 'metadata_plugin', queryText: 'claude plugin in:name,description,topics is:public', lane: 'metadata' },
  { queryId: 'metadata_marketplace', queryText: 'claude marketplace in:name,description,topics is:public', lane: 'metadata' },
  { queryId: 'readme_plugin', queryText: 'claude plugin in:readme is:public', lane: 'readme' },
  { queryId: 'readme_marketplace', queryText: 'claude marketplace in:readme is:public', lane: 'readme' },
]

export type DateWindow = { field: 'created' | 'pushed'; start: string; end: string }
const dayMs = 86_400_000

function dateOnly(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function partitionKey(window: DateWindow): string {
  return `${window.field}:${window.start}..${window.end}`
}

export function buildRepositorySearchQuery(query: RepositorySearchQuery, window: DateWindow): string {
  return `${query.queryText} ${partitionKey(window)}`
}

export function rollingPushedWindow(now: string): DateWindow {
  const end = dateOnly(Date.parse(now))
  return { field: 'pushed', start: dateOnly(Date.parse(end) - 29 * dayMs), end }
}

export function historicalWindows(now: string): DateWindow[] {
  const end = dateOnly(Date.parse(now))
  const windows: DateWindow[] = []
  for (let year = 2008; year <= Number(end.slice(0, 4)); year++) {
    // Keep the current year's checkpoint stable; pushed scans cover new repositories between refreshes.
    windows.push({ field: 'created', start: `${year}-01-01`, end: `${year}-12-31` })
  }
  return windows
}

export function splitDateWindow(window: DateWindow): [DateWindow, DateWindow] | null {
  const firstDay = Date.parse(window.start) / dayMs
  const lastDay = Date.parse(window.end) / dayMs
  if (firstDay >= lastDay) return null
  const middleDay = Math.floor((firstDay + lastDay) / 2)
  return [
    { ...window, end: dateOnly(middleDay * dayMs) },
    { ...window, start: dateOnly((middleDay + 1) * dayMs) },
  ]
}
