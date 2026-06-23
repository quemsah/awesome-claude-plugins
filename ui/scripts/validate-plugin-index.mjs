import { readFileSync } from 'node:fs'
import { IndexedPluginsArraySchema } from '../src/schemas/plugin.schema.ts'

const indexedPlugins = JSON.parse(readFileSync(new URL('../src/data/plugins.json', import.meta.url), 'utf8'))
const result = IndexedPluginsArraySchema.safeParse(indexedPlugins)

if (!result.success) {
  console.error('Plugin index validation failed:')
  result.error.issues.forEach((issue) => {
    console.error(`- ${issue.path.join('.')}: ${issue.message}`)
  })
  process.exitCode = 1
} else {
  console.log(`Plugin index validation passed for ${result.data.length} indexed plugins.`)
}
