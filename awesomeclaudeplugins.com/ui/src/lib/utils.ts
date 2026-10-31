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

/** Human-readable age of a GitHub event. Returns null for unknown/invalid timestamps. */
export function formatRelativeTime(value: string | Date | number | null | undefined, nowMs = Date.now()): string | null {
  if (value == null || value === '') return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const seconds = Math.floor((nowMs - time) / 1_000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) {
    const months = Math.floor(days / 30)
    return `${months} ${months === 1 ? 'month' : 'months'} ago`
  }
  const years = Math.floor(days / 365)
  return `${years} ${years === 1 ? 'year' : 'years'} ago`
}
