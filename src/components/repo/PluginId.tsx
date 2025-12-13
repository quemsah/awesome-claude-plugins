interface PluginIdProps {
  id?: string
}

export function PluginId({ id }: PluginIdProps) {
  if (!id) return null

  return (
    <div>
      <h3 className="mb-0.5 font-medium text-sm">Plugin ID</h3>
      <p className="break-all text-muted-foreground text-sm">{id}</p>
    </div>
  )
}
