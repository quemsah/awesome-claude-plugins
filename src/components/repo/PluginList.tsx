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
      <h3 className="font-medium text-sm mb-0.5">
        {title} ({items.length})
      </h3>
      <ul className="text-muted-foreground text-sm list-disc list-inside space-y-0.5">
        {items.map((item) => {
          const fileUrl = `https://github.com/${repoPath}/blob/${defaultBranch || 'main'}/${item}`
          return (
            <li className="break-all" key={item}>
              <a
                className="hover:text-primary hover:underline underline-offset-4 transition-colors group-hover:text-primary"
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
