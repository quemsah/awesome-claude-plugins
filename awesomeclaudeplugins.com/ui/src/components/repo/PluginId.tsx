interface PluginIdProps {
  id?: string
}

export function PluginId({ id }: PluginIdProps) {
  if (!id) return null

  return (
    <div>
      <dt className="mb-0.5 text-sm font-medium">Plugin ID</dt>
      <dd className="text-muted-foreground text-sm break-all">{id}</dd>
    </div>
  )
}
