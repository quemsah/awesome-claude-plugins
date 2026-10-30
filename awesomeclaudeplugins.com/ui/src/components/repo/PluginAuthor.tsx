import type { PluginAuthor as PluginAuthorType } from '../../app/types/plugin.type.ts'

interface PluginAuthorProps {
  author?: PluginAuthorType
}

export function PluginAuthor({ author }: PluginAuthorProps) {
  if (!author) return null
  if (!author.name) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">Author</dt>
      <dd className="text-muted-foreground text-sm">
        <p className="font-medium">{author.name}</p>
      </dd>
    </div>
  )
}
