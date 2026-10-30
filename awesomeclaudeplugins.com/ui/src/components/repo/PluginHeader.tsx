import { Badge } from '../ui/badge.tsx'
import { CardHeader, CardTitle } from '../ui/card.tsx'

interface PluginHeaderProps {
  name?: string
  version?: string
  category?: string
}

export function PluginHeader({ name, version, category }: PluginHeaderProps) {
  return (
    <CardHeader className="-space-y-2 pb-3">
      <div className="flex items-start justify-between">
        <div>
          <CardTitle className="font-bold text-lg transition-colors duration-300 group-hover:text-primary">
            <h3>
              {name || 'Unnamed Plugin'}
              {version ? <span className="text-muted-foreground">@{version}</span> : null}
            </h3>
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
