interface PluginDescriptionProps {
  description?: string
}

export function PluginDescription({ description }: PluginDescriptionProps) {
  if (!description) return null

  return (
    <div>
      <h6 className="mb-0.5 font-medium text-sm">Description</h6>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  )
}
