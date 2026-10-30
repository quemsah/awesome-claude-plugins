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

function isOptionalBoundedText(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= maxLength && isWellFormedUnicode(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isPluginSummary(value: unknown): value is PluginSummary {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => key !== 'name' && key !== 'description')) return false
  if (!isOptionalBoundedText(value.name, 160) || !isOptionalBoundedText(value.description, 300)) return false
  return value.name !== undefined || value.description !== undefined
}

export function isPluginSummaries(value: unknown): value is PluginSummary[] {
  return Array.isArray(value) && value.length <= 30 && value.every(isPluginSummary)
}

export function parsePluginSummariesJson(value: string | null): PluginSummary[] | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isPluginSummaries(parsed) ? parsed : null
  } catch {
    return null
  }
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
