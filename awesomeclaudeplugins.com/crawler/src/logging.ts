export type LogEvent = {
  level: 'error' | 'warn' | 'info'
  phase: string
  category: string
  event?: string
  message?: string
  runId?: string
  [key: string]: unknown
}

export type Log = (event: LogEvent) => void
