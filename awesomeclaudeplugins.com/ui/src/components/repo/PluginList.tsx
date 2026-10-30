import type { Plugin, PluginSource } from '../../app/types/plugin.type.ts'
import { getMcpBundleUrl } from '../../lib/mcpBundleUrl.ts'
import { getPluginComponentFileUrl } from '../../lib/pluginComponentUrl.ts'

interface PluginListProps {
  title: string
  items?: Plugin['commands'] | Plugin['mcpServers']
  repoPath: string
  defaultBranch?: string
  source?: string | PluginSource
}

type ListEntry = { label: string; isPath: boolean }

/** Keep path entries linkable while rendering names from inline maps as plain text. */
function getListEntries(items: PluginListProps['items']): ListEntry[] {
  const values = typeof items === 'string' ? [items] : Array.isArray(items) ? items : items ? [items] : []
  return values.flatMap((value): ListEntry[] =>
    typeof value === 'string' ? [{ label: value, isPath: true }] : Object.keys(value).map((label) => ({ label, isPath: false }))
  )
}

/** Display component paths, inline names, and verified external MCP bundle URLs. */
export function PluginList({ title, items, repoPath, defaultBranch, source }: PluginListProps) {
  const listItems = getListEntries(items)
  if (!listItems.length) return null

  return (
    <div>
      <dt className="mb-0.5 text-sm font-medium">
        {title} ({listItems.length})
      </dt>
      <dd>
        <ul className="text-muted-foreground list-inside list-disc space-y-0.5 text-sm">
          {listItems.map(({ label, isPath }, index) => {
            const fileUrl = isPath
              ? ((title === 'MCP Servers' ? getMcpBundleUrl(label) : null) ??
                getPluginComponentFileUrl(source, repoPath, defaultBranch, label))
              : null
            return (
              <li className="break-all" key={`${index}-${label}`}>
                {fileUrl ? (
                  <a
                    aria-label={`Open ${label} in a new tab`}
                    className="hover:text-primary group-hover:text-primary underline-offset-4 transition-colors hover:underline"
                    href={fileUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {label}
                  </a>
                ) : (
                  label
                )}
              </li>
            )
          })}
        </ul>
      </dd>
    </div>
  )
}
