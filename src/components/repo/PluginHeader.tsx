import { Badge } from '../ui/badge.tsx'
import { CardHeader, CardTitle } from '../ui/card.tsx'

interface PluginHeaderProps {
  name?: string
  version?: string
  category?: string
}

export function PluginHeader({ name, version, category }: PluginHeaderProps) {
  return (
    <CardHeader className="pb-3 -space-y-2">
      <div className="flex justify-between items-start">
        <div>
          <CardTitle className="text-lg font-bold group-hover:text-primary transition-colors duration-300">
            {name || 'Unnamed Plugin'}
            {version ? <span className="text-muted-foreground">@{version}</span> : null}
          </CardTitle>
        </div>
        {category ? (
          <Badge className="ml-3 text-xs" variant="outline">
            {category}
          </Badge>
        ) : null}
      </div>
    </CardHeader>
  )
}
