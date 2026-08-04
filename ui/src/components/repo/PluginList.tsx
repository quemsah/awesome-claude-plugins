interface PluginListProps {
  title: string
  items?: string[] | Record<string, unknown>
  repoPath: string
  defaultBranch?: string
}

export function PluginList({ title, items, repoPath, defaultBranch }: PluginListProps) {
  const listItems = Array.isArray(items) ? items : []
  if (!(listItems.length && defaultBranch)) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">
        {title} ({listItems.length})
      </dt>
      <dd>
        <ul className="list-inside list-disc space-y-0.5 text-muted-foreground text-sm">
          {listItems.map((item) => {
            const fileUrl = `https://github.com/${repoPath}/blob/${defaultBranch}/${item}`
            return (
              <li className="break-all" key={item}>
                <a
                  aria-label={`Open ${item} in a new tab`}
                  className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
                  href={fileUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item}
                </a>
              </li>
            )
          })}
        </ul>
      </dd>
    </div>
  )
}
