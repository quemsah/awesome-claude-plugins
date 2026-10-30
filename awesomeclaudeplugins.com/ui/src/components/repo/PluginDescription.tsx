interface PluginDescriptionProps {
  description?: string
}

export function PluginDescription({ description }: PluginDescriptionProps) {
  if (!description) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">Description</dt>
      <dd className="text-muted-foreground text-sm">{description}</dd>
    </div>
  )
}
