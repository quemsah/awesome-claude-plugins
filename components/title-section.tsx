interface TitleSectionProps {
  pluginsLength?: number
}

export function TitleSection({ pluginsLength }: TitleSectionProps) {
  return (
    <div className="space-y-2 text-center mb-8">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">awesome-claude-plugins</h1>
      <p className="text-muted-foreground">Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows</p>
      {pluginsLength !== undefined && pluginsLength > 0 && (
        <p className="text-sm text-muted-foreground">{pluginsLength} plugins available</p>
      )}
    </div>
  )
}
