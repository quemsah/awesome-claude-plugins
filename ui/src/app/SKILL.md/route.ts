import { BASE_URL } from '../../lib/constants.ts'

export const dynamic = 'force-static'

export function GET() {
  const content = `# Awesome Claude Plugins Catalog

Discover public GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

## Browse the catalog

- Start at [the catalog](${BASE_URL}/) to search repositories by name or description.
- Follow [catalog browse pages](${BASE_URL}/browse/2) to traverse the complete server-rendered catalog.
- Use [the sitemap](${BASE_URL}/sitemap.xml) for canonical repository URLs.

## Repository details

Each canonical \`/{owner}/{repo}\` page contains repository metadata, available marketplace plugins, and a copyable install command when the repository exposes one.

Install commands use this form:

\`\`\`bash
/plugin marketplace add owner/repo
\`\`\`

## Machine-readable resources

- [llms.txt](${BASE_URL}/llms.txt)
- [API catalog](${BASE_URL}/.well-known/api-catalog)
- [Agent skills index](${BASE_URL}/.well-known/agent-skills/index.json)
`

  return new Response(content, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  })
}
