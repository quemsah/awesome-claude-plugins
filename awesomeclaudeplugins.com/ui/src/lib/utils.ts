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
