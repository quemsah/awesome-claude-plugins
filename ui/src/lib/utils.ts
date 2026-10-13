import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date): string {
  return dateFormatter.format(date)
}

export function formatRelativeTime(dateInput: string | Date | number | null | undefined, nowMs = Date.now()): string | null {
  if (!dateInput) return null
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput
  const time = date.getTime()
  if (Number.isNaN(time)) return null

  const diffMs = nowMs - time
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 0) return 'just now'
  if (diffSec < 60) return 'just now'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays} days ago`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths === 1) return '1 month ago'
  if (diffMonths < 12) return `${diffMonths} months ago`

  const diffYears = Math.floor(diffDays / 365)
  if (diffYears === 1) return '1 year ago'
  return `${diffYears} years ago`
}
