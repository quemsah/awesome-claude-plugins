import { NextResponse } from 'next/server'
import pluginsData from '@/data/plugins.json' with { type: 'json' }
import type { Plugin } from '../../types/plugin.type.ts'

export function GET() {
  const plugins: Plugin[] = pluginsData.map((item: { json: Plugin }) => item.json)

  const validPlugins = plugins
    .filter((plugin) => plugin.repo_name !== null)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))

  return NextResponse.json(validPlugins)
}
