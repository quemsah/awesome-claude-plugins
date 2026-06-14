'use client'

import { useId } from 'react'

interface PluginListProps {
  title: string
  items?: string[]
  repoPath: string
  defaultBranch?: string
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'heading'
  )
}

export function PluginList({ title, items, repoPath, defaultBranch }: PluginListProps) {
  const generatedId = useId()
  const headingId = `${generatedId}-${slugify(title)}-heading`

  if (!items?.length) return null

  return (
    <section aria-labelledby={headingId} className="plugin-list">
      <h6 className="mb-0.5 font-medium text-sm" id={headingId}>
        {title} ({items.length})
      </h6>
      <ul className="list-inside list-disc space-y-0.5 text-muted-foreground text-sm">
        {items.map((item) => {
          const fileUrl = `https://github.com/${repoPath}/blob/${defaultBranch || 'main'}/${item}`
          return (
            <li className="break-all" key={item}>
              <a
                aria-label={`Open ${item} in new tab`}
                className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
                href={fileUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {item}
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
