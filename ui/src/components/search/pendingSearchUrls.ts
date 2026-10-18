/**
 * Next router writes can finish out of order. We must distinguish URL changes we requested
 * from browser history/external navigation without retaining superseded URLs indefinitely.
 */
export class PendingSearchUrls {
  private readonly pending = new Map<string, number>()
  private nextRequestId = 0

  track(url: string): void {
    this.pending.set(url, ++this.nextRequestId)
  }

  /** True if this URL was requested locally and should not overwrite the draft search input. */
  consume(url: string): boolean {
    const committedRequestId = this.pending.get(url)
    if (committedRequestId === undefined) {
      this.pending.clear()
      return false
    }

    // A newer successful navigation supersedes older pending requests (including cancelled
    // router.replace calls). Do not let their markers mask unrelated navigation later.
    for (const [pendingUrl, requestId] of this.pending) {
      if (requestId <= committedRequestId) this.pending.delete(pendingUrl)
    }
    return true
  }

  clear(): void {
    this.pending.clear()
  }
}
