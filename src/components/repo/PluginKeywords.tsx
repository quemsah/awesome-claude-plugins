import { Badge } from '../ui/badge.tsx'

interface PluginKeywordsProps {
  keywords?: string[]
}

export function PluginKeywords({ keywords }: PluginKeywordsProps) {
  if (!keywords?.length) return null

  return (
    <div>
      <h3 className="font-medium text-sm mb-0.5">Keywords</h3>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword, index) => (
          <Badge className="text-xs py-0.5 px-1.5" key={`${keyword}-${index}`} variant="outline">
            {keyword}
          </Badge>
        ))}
      </div>
    </div>
  )
}
