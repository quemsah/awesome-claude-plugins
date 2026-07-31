import Link from 'next/link'
import type { Breadcrumb } from '../../lib/breadcrumbs.ts'

type BreadcrumbsProps = {
  items: readonly Breadcrumb[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-muted-foreground text-sm">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => (
          <li className="flex items-center gap-2" key={item.url}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {index === items.length - 1 ? (
              <span aria-current="page">{item.name}</span>
            ) : (
              <Link className="underline-offset-4 hover:text-foreground hover:underline" href={new URL(item.url).pathname}>
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
