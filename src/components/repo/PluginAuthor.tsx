import type { PluginAuthor as PluginAuthorType } from '../../app/types/plugin.type.ts'

interface PluginAuthorProps {
  author?: PluginAuthorType
}

export function PluginAuthor({ author }: PluginAuthorProps) {
  if (!author) return null
  if (!(author.name || author.email)) return null

  return (
    <div>
      <h3 className="font-medium text-sm mb-0.5">Author</h3>
      <div className="text-muted-foreground text-sm">
        {author.name ? (
          <p className="font-medium">
            {author.name}
            {author.email ? <span className="font-normal"> ({author.email})</span> : null}
          </p>
        ) : author.email ? (
          <p className="break-all">{author.email}</p>
        ) : null}
      </div>
    </div>
  )
}
