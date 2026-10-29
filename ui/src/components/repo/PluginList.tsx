import { getGitHubBlobUrl } from '../../lib/repositoryIdentity.ts'

interface PluginListProps {
  title: string
  items?: string | string[] | Record<string, unknown>
  repoPath: string
  defaultBranch?: string
}

export function PluginList({ title, items, repoPath, defaultBranch }: PluginListProps) {
  // Array entries are repository paths; object-map keys are component names, not necessarily paths.
  const isPathList = typeof items === 'string' || Array.isArray(items)
  const listItems = typeof items === 'string' ? [items] : Array.isArray(items) ? items : Object.keys(items ?? {})
  if (listItems.length === 0 || (isPathList && !defaultBranch)) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">
        {title} ({listItems.length})
      </dt>
      <dd>
        <ul className="list-inside list-disc space-y-0.5 text-muted-foreground text-sm">
          {listItems.map((item) => (
            <li className="break-all" key={item}>
              {isPathList && defaultBranch ? (
                <a
                  aria-label={`Open ${item} in a new tab`}
                  className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
                  href={getGitHubBlobUrl(repoPath, defaultBranch, item)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item}
                </a>
              ) : (
                <span>{item}</span>
              )}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  )
}
