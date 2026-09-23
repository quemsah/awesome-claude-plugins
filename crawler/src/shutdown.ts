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

export function sleepWithShutdown(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfShutdown(signal)
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new ShutdownError())
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
