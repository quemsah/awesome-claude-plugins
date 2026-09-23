export class ShutdownError extends Error {
  readonly category = 'terminated'

  constructor() {
    super('Shutdown requested')
    this.name = 'ShutdownError'
  }
}

export function throwIfShutdown(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ShutdownError()
}
