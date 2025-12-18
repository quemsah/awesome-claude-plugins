import { Badge } from '../ui/badge.tsx'

interface PluginKeywordsProps {
  keywords?: string[]
}

export function PluginKeywords({ keywords }: PluginKeywordsProps) {
  if (!keywords?.length) return null

  return (
    <div>
      <h6 className="mb-0.5 font-medium text-sm">Keywords</h6>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword, index) => (
          <Badge className="px-1.5 py-0.5 text-xs" key={`${keyword}-${index}`} variant="outline">
            {keyword}
          </Badge>
        ))}
      </div>
    </div>
  )
}
