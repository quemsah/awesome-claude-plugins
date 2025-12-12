interface PluginDescriptionProps {
  description?: string
}

export function PluginDescription({ description }: PluginDescriptionProps) {
  if (!description) return null

  return (
    <div>
      <h3 className="font-medium text-sm mb-0.5">Description</h3>
      <p className="text-muted-foreground text-sm opacity-90 group-hover:opacity-100 transition-opacity duration-300">{description}</p>
    </div>
  )
}
