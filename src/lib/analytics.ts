import process from 'node:process'
import { sendGAEvent } from '@next/third-parties/google'

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-XXXXXXXXXX'
export const isAnalyticsEnabled = (): boolean => process.env.NODE_ENV === 'production' && GA_ID !== 'G-XXXXXXXXXX'

export interface WebVitalsMetric {
  id: string
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  label?: string
  attribution?: Record<string, unknown>
}

export interface GaEvent {
  action: string
  category?: string
  label?: string
  value?: number
  customParameters?: Record<string, unknown>
}

export function reportWebVitals(metric: WebVitalsMetric): void {
  if (!isAnalyticsEnabled()) {
    if (process.env.NODE_ENV === 'development') {
      console.info('Web Vitals (dev):', metric)
    }
    return
  }

  if (metric.label !== 'web-vital') {
    return
  }

  const value = Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value)

  if (isAnalyticsEnabled()) {
    sendGAEvent({
      eventName: 'web_vitals',
      eventCategory: 'Web Vitals',
      eventLabel: metric.name,
      value: value,
      metricId: metric.id,
      metricRating: metric.rating,
      metricDelta: metric.delta,
      customParameters: metric.attribution || {},
    })
  }
}

export function trackEvent(event: GaEvent): void {
  if (!isAnalyticsEnabled()) {
    return
  }

  if (isAnalyticsEnabled()) {
    sendGAEvent({
      eventName: event.action,
      eventCategory: event.category || 'engagement',
      eventLabel: event.label,
      value: event.value,
      customParameters: event.customParameters,
    })
  }
}

export function trackPageView(url: string, title?: string): void {
  if (!isAnalyticsEnabled() || typeof window === 'undefined') {
    return
  }

  if (isAnalyticsEnabled()) {
    sendGAEvent({
      eventName: 'page_view',
      pageLocation: url,
      pageTitle: title || document.title,
    })
  }
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}
