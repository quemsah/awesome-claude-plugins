interface TitleSectionProps {
  pluginsLength?: number
}

export function TitleSection({ pluginsLength }: TitleSectionProps) {
  return (
    <div className="space-y-2 text-center mb-8">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">Awesome Claude Plugins</h1>
      <p className="text-muted-foreground">Discover and explore Claude Code plugins from the community</p>
      {pluginsLength !== undefined && pluginsLength > 0 && (
        <p className="text-sm text-muted-foreground">{pluginsLength} plugins available</p>
      )}
    </div>
  )
}
