interface PluginDescriptionProps {
  description?: string
}

export function PluginDescription({ description }: PluginDescriptionProps) {
  if (!description) return null

  return (
    <div>
      <dt className="mb-0.5 text-sm font-medium">Description</dt>
      <dd className="text-muted-foreground text-sm">{description}</dd>
    </div>
  )
}
