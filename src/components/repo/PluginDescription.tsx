interface PluginDescriptionProps {
  description?: string
}

export function PluginDescription({ description }: PluginDescriptionProps) {
  if (!description) return null

  return (
    <div>
      <h3 className="mb-0.5 font-medium text-sm">Description</h3>
      <p className="text-muted-foreground text-sm opacity-90 transition-opacity duration-300 group-hover:opacity-100">{description}</p>
    </div>
  )
}
