import { BASE_URL } from '../../lib/constants.ts'
import { renderCatalogApiContract, renderCatalogResourceLinks } from '../../lib/discovery.ts'

export const dynamic = 'force-static'

export function GET() {
  const content = `# Awesome Claude Plugins Catalog - Agent Workflow Guide

An actionable step-by-step guide for AI coding agents to discover, evaluate, and install Claude Code plugins, MCP servers, and agent skills.

## Safety Notice

> [!WARNING]
> **Public, unvetted repositories**: The catalog indexes public GitHub repositories discovered across the open-source ecosystem. Indexed repositories and plugins are NOT audited, vetted, or endorsed.
>
> Before installing any plugin, the agent MUST:
> 1. **Inspect configurations and code**: Examine the repository's MCP server configuration (e.g., in \`.claude-plugin/marketplace.json\` or \`mcp.json\`), lifecycle hooks, and declared commands before running them.
> 2. **Summarize for the user**: Present a clear summary of all MCP servers, filesystem/network permissions, background hooks, and executable commands to the user.
> 3. **Obtain user approval**: Never install third-party plugins or run unvetted scripts without explicit user confirmation.

## Actionable Agent Workflow

When a user asks to find and install a plugin for a task (e.g., "find a plugin for Postgres and install it"):

### Step 1: Search the catalog API
Query the catalog API using the user's task keywords, sorted by stars descending:

\`\`\`http
GET ${BASE_URL}/api/catalog?q={task}&sort=stars-desc
\`\`\`

Example:
\`GET ${BASE_URL}/api/catalog?q=postgres&sort=stars-desc\`

The API returns a JSON object with \`{ repos, total, hasMore, pluginsCount }\`. When available, each repository item includes plugin names and descriptions in \`plugins\` so you can evaluate matches directly from the search response.

### Step 2: Filter candidate results
Filter the search results according to quality signals:
- **Discard entries with 0 stars** (\`stargazers_count === 0\` or \`stargazers_count === null\`).
- **Discard entries missing a description** (\`description === null\` or empty).
- **Prioritize entries** with validated plugin counts (\`plugins_count > 0\`) and descriptions matching the task.

### Step 3: Retrieve Markdown details
Fetch the Markdown detail document for the selected repository candidate:

\`\`\`http
GET ${BASE_URL}/{owner}/{repo}.md
\`\`\`

*(Note: For repositories whose name already ends in \`.md\`, such as \`sstklen/yes.md\`, fetch \`${BASE_URL}/sstklen/yes.md.md\`)*.

Inspect the Markdown frontmatter and body for:
- Repository metadata, quality notes, and publication state.
- Available marketplace install command and plugin configurations.

### Step 4: Execute installation commands
After inspecting the plugin and obtaining user confirmation, run the two Claude Code commands:

1. Add the marketplace repository:
\`\`\`bash
/plugin marketplace add {owner}/{repo}
\`\`\`

2. Install the specific plugin from that marketplace:
\`\`\`bash
/plugin install {plugin_name}@{marketplace}
\`\`\`

*(Where \`{marketplace}\` is the marketplace identifier declared in the repository manifest or the repository name)*.

## Catalog API Specification

${renderCatalogApiContract()}

## Machine-Readable Resources

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
