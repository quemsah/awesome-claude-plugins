export type PluginSummary = { name?: string; description?: string }

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

export function parsePluginSummariesJson(value: string | null): PluginSummary[] | null {
  if (value === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length > 30) return null

  const summaries: PluginSummary[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const keys = Object.keys(item)
    if (keys.some((key) => key !== 'name' && key !== 'description')) return null
    const summary = item as Record<string, unknown>
    const name = summary.name
    const description = summary.description
    if (
      (name !== undefined && (typeof name !== 'string' || !name || name.length > 160 || !isWellFormedUnicode(name))) ||
      (description !== undefined &&
        (typeof description !== 'string' || !description || description.length > 300 || !isWellFormedUnicode(description))) ||
      (name === undefined && description === undefined)
    ) {
      return null
    }
    summaries.push({ ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) })
  }
  return summaries
}

export function serializePluginSummaries(items: readonly unknown[]): string {
  const summaries: PluginSummary[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? boundedDisplayText(record.name, 160) : ''
    const description = typeof record.description === 'string' ? boundedDisplayText(record.description, 300) : ''
    if (name || description) summaries.push({ ...(name ? { name } : {}), ...(description ? { description } : {}) })
    if (summaries.length >= 30) break
  }
  return JSON.stringify(summaries)
}

function boundedDisplayText(value: string, maxLength: number): string {
  const input = value.trim()
  let output = ''
  for (let index = 0; index < input.length && output.length < maxLength; index++) {
    const code = input.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (output.length + 2 > maxLength) break
        output += input.slice(index, index + 2)
        index++
      } else {
        output += '\ufffd'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd'
    } else {
      output += input[index]
    }
  }
  return output
}
