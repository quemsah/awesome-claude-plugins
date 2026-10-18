declare global {
  interface Window {
    // biome-ignore lint/style/useNamingConvention: Simple Analytics global function name
    sa_event?: (event: string, metadata?: Record<string, string | number>, callback?: () => void) => void
    doNotTrack?: string
  }
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

export type AnalyticsEvent =
  | 'copy_marketplace_add'
  | 'copy_plugin_install'
  | 'open_github'
  | 'search_no_results'
  | 'sort_change'
  | 'filter_change'

export type AnalyticsMetadata = Record<string, string | number>

export function shouldLoadAnalytics(railwayEnvironmentName: string | undefined): boolean {
  return railwayEnvironmentName === 'production'
}

export function isPrivacyRestricted(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  if (navigator.globalPrivacyControl === true) {
    return true
  }

  const nav = navigator as Navigator & { msDoNotTrack?: string }
  const win = typeof window !== 'undefined' ? (window as Window & { msDoNotTrack?: string }) : undefined

  const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? win?.doNotTrack ?? win?.msDoNotTrack
  return dnt === '1' || dnt === 'yes'
}

export function isAnalyticsActive(): boolean {
  return typeof window !== 'undefined' && typeof window.sa_event === 'function' && !isPrivacyRestricted()
}

// A user can click before the deferred analytics script becomes ready. Keep a small
// bounded, anonymous queue and deliver it when the script reports readiness.
const pendingEvents: Array<{ event: AnalyticsEvent; metadata?: AnalyticsMetadata }> = []
const MAX_PENDING_EVENTS = 25

export function flushPendingEvents(): void {
  if (isPrivacyRestricted()) {
    pendingEvents.length = 0
    return
  }
  if (!isAnalyticsActive()) return
  while (pendingEvents.length > 0) {
    const item = pendingEvents.shift()
    if (!item) break
    try {
      window.sa_event?.(item.event, item.metadata)
    } catch {
      // Analytics must never interfere with user interactions.
    }
  }
}

export function trackEvent(event: AnalyticsEvent, metadata?: AnalyticsMetadata): boolean {
  if (typeof window === 'undefined') return false
  if (isPrivacyRestricted()) {
    pendingEvents.length = 0
    return false
  }
  if (!isAnalyticsActive()) {
    if (pendingEvents.length === MAX_PENDING_EVENTS) pendingEvents.shift()
    pendingEvents.push({ event, ...(metadata ? { metadata } : {}) })
    return false
  }

  try {
    if (metadata && Object.keys(metadata).length > 0) {
      window.sa_event?.(event, metadata)
    } else {
      window.sa_event?.(event)
    }
    return true
  } catch {
    return false
  }
}

export function trackCopyMarketplaceAdd(): boolean {
  return trackEvent('copy_marketplace_add')
}

export function trackCopyPluginInstall(): boolean {
  return trackEvent('copy_plugin_install')
}

export function trackOpenGithub(): boolean {
  return trackEvent('open_github')
}

export function trackSearchNoResults(): boolean {
  return trackEvent('search_no_results')
}

export function trackSortChange(sort: string): boolean {
  return trackEvent('sort_change', { sort })
}

export function trackFilterChange(filter: string): boolean {
  return trackEvent('filter_change', { filter })
}
