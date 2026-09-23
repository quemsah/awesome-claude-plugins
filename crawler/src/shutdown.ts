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

export async function waitForShutdownAware<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  throwIfShutdown(signal)

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(new ShutdownError())
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)

    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}
