/** biome-ignore-all lint/style/useNamingConvention: JSON Feed requires snake_case fields. */
import reposData from '../../data/repos.json' with { type: 'json' }
import statsData from '../../data/stats.json' with { type: 'json' }
import { BASE_URL } from '../../lib/constants.ts'
import { getCatalogSummary } from '../../lib/llmsText.ts'

export const dynamic = 'force-static'

export function GET() {
  const summary = getCatalogSummary(reposData, statsData)
  const updatedAt = summary.updatedAt ? new Date(summary.updatedAt).toISOString() : undefined
  const content = `The catalog contains ${summary.repoCount} repositories, ${summary.pluginRepositoryCount} repositories with validated plugin counts, and ${summary.pluginCount} reported plugin entries.`

  return Response.json(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Awesome Claude Plugins',
      home_page_url: BASE_URL,
      feed_url: `${BASE_URL}/feed.json`,
      description: 'Updates to the Awesome Claude Plugins repository catalog.',
      icon: `${BASE_URL}/favicon.svg`,
      items: [
        {
          id: `${BASE_URL}/catalog-snapshot/${updatedAt ?? 'unknown'}`,
          url: BASE_URL,
          title: 'Catalog snapshot',
          content_text: content,
          ...(updatedAt ? { date_published: updatedAt, date_modified: updatedAt } : {}),
        },
      ],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/feed+json; charset=utf-8',
      },
    }
  )
}
