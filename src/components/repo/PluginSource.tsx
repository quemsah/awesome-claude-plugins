interface PluginSourceProps {
  source?: string
  repoPath: string
  defaultBranch?: string
}

export function PluginSource({ source, repoPath, defaultBranch }: PluginSourceProps) {
  if (!source) return null

  return (
    <div>
      <h3 className="font-medium text-sm mb-0.5">Source</h3>
      <p className="text-muted-foreground text-sm break-all">
        <a
          className="hover:text-primary hover:underline underline-offset-4 transition-colors group-hover:text-primary"
          href={`https://github.com/${repoPath}/blob/${defaultBranch}/${source}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {source}
        </a>
      </p>
    </div>
  )
}
