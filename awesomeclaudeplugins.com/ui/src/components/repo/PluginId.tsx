interface PluginIdProps {
  id?: string
}

export function PluginId({ id }: PluginIdProps) {
  if (!id) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">Plugin ID</dt>
      <dd className="break-all text-muted-foreground text-sm">{id}</dd>
    </div>
  )
}
