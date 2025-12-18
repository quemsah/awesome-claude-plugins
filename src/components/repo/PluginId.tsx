interface PluginIdProps {
  id?: string
}

export function PluginId({ id }: PluginIdProps) {
  if (!id) return null

  return (
    <div>
      <h6 className="mb-0.5 font-medium text-sm">Plugin ID</h6>
      <p className="break-all text-muted-foreground text-sm">{id}</p>
    </div>
  )
}
