import { Badge } from '../ui/badge.tsx'

interface PluginKeywordsProps {
  keywords?: string[]
}

export function PluginKeywords({ keywords }: PluginKeywordsProps) {
  if (!keywords?.length) return null

  return (
    <div>
      <dt className="mb-0.5 text-sm font-medium">Keywords</dt>
      <dd className="flex flex-wrap gap-1.5">
        {keywords.map((keyword, index) => (
          <Badge className="px-1.5 py-0.5 text-xs" key={`${keyword}-${index}`} variant="outline">
            {keyword}
          </Badge>
        ))}
      </dd>
    </div>
  )
}
