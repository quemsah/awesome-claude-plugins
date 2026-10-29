import type { PluginSource } from '../../app/types/plugin.type.ts'
import { getPluginComponentFileUrl } from '../../lib/pluginComponentUrl.ts'

interface PluginListProps {
  title: string
  items?: string[] | Record<string, unknown>
  repoPath: string
  defaultBranch?: string
  source?: string | PluginSource
}

export function PluginList({ title, items, repoPath, defaultBranch, source }: PluginListProps) {
  const isPathList = Array.isArray(items)
  const listItems = isPathList ? items : Object.keys(items ?? {})
  if (!listItems.length) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">
        {title} ({listItems.length})
      </dt>
      <dd>
        <ul className="list-inside list-disc space-y-0.5 text-muted-foreground text-sm">
          {listItems.map((item) => {
            const fileUrl = isPathList ? getPluginComponentFileUrl(source, repoPath, defaultBranch, item) : null
            return (
              <li className="break-all" key={item}>
                {fileUrl ? (
                  <a
                    aria-label={`Open ${item} in a new tab`}
                    className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
                    href={fileUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item}
                  </a>
                ) : (
                  item
                )}
              </li>
            )
          })}

        </ul>
      </dd>
    </div>
  )
}
