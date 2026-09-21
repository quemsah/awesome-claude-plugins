import { BASE_URL } from '../../lib/constants.ts'
import { renderCatalogApiContract, renderCatalogResourceLinks } from '../../lib/discovery.ts'

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

## Query the catalog API

${renderCatalogApiContract()}

Repository detail pages are also published as Markdown at \`/{owner}/{repo}.md\`, which serves \`text/markdown; charset=utf-8\` with the same install command shown above. A repository whose own name already ends in \`.md\` keeps that path as its HTML page, so its Markdown is served one suffix further out (\`/sstklen/yes.md.md\`); each detail page announces its own address in a \`<link rel="alternate" type="text/markdown">\`.

## Machine-readable resources

Every response also carries a \`Link\` header pointing at [the API catalog](${BASE_URL}/.well-known/api-catalog), which publishes the resources below as an RFC 9264 linkset (\`application/linkset+json\`).

${renderCatalogResourceLinks()}
- [API catalog](${BASE_URL}/.well-known/api-catalog): this document in machine-readable form.
- [Security contact](${BASE_URL}/.well-known/security.txt): where to report issues.
`

  return new Response(content, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  })
}
