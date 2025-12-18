interface PluginListProps {
  title: string
  items?: string[]
  repoPath: string
  defaultBranch?: string
}

export function PluginList({ title, items, repoPath, defaultBranch }: PluginListProps) {
  if (!items?.length) return null

  return (
    <div>
      <h6 className="mb-0.5 font-medium text-sm">
        {title} ({items.length})
      </h6>
      <ul className="list-inside list-disc space-y-0.5 text-muted-foreground text-sm">
        {items.map((item) => {
          const fileUrl = `https://github.com/${repoPath}/blob/${defaultBranch || 'main'}/${item}`
          return (
            <li className="break-all" key={item}>
              <a
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
    </div>
  )
}
