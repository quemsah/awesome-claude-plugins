interface PluginIdProps {
  id?: string
}

export function PluginId({ id }: PluginIdProps) {
  if (!id) return null

  return (
    <div>
      <h3 className="font-medium text-sm mb-0.5">Plugin ID</h3>
      <p className="text-muted-foreground text-sm break-all">{id}</p>
    </div>
  )
}
