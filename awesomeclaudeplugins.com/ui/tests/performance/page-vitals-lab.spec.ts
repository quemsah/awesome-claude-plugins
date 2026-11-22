import { expect, test } from '@playwright/test'

const ROUTES = ['/', '/browse/2', '/ykdojo/claude-code-tips', '/stats']
const REPEATS = 3
const SETTLE_MS = 500

type Measurement = {
  browserProject: string
  deviceScaleFactor: number
  htmlTransferBytes: number
  lcpMs: number
  cls: number
  route: string
  sample: number
  ttfbMs: number
  userAgent: string
  viewport: { height: number; width: number }
}

test('records repeatable lab Web Vitals and HTML transfer size for target routes', async ({ page }, testInfo) => {
  test.setTimeout(180_000)

  // Keep this local lab run stable by excluding third-party analytics and avatars.
  for (const origin of [
    'https://scripts.simpleanalyticscdn.com/**',
    'https://queue.simpleanalyticscdn.com/**',
    'https://avatars.githubusercontent.com/**',
  ]) {
    await page.route(origin, (route) => route.abort())
  }

  await page.addInitScript(() => {
    type LabState = { cls: number; lastShift: number; lcpMs: number | null; sessionStart: number; sessionValue: number }
    const state: LabState = {
      cls: 0,
      lastShift: Number.NEGATIVE_INFINITY,
      lcpMs: null,
      sessionStart: Number.NEGATIVE_INFINITY,
      sessionValue: 0,
    }
    ;(window as Window & { __pageVitalsLab?: LabState }).__pageVitalsLab = state

    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const latest = entries.at(-1)
      if (latest) state.lcpMs = latest.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number }
        if (shift.hadRecentInput) continue

        if (shift.startTime - state.lastShift > 1_000 || shift.startTime - state.sessionStart > 5_000) {
          state.sessionStart = shift.startTime
          state.sessionValue = shift.value
        } else {
          state.sessionValue += shift.value
        }

        state.lastShift = shift.startTime
        state.cls = Math.max(state.cls, state.sessionValue)
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })

  const measurements: Measurement[] = []

  for (let sample = 1; sample <= REPEATS; sample += 1) {
    for (const route of ROUTES) {
      const response = await page.goto(route, { waitUntil: 'load' })
      if (!response) throw new Error(`${route} navigation did not return a document`)
      expect(response.status(), `${route} should return a document`).toBe(200)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(SETTLE_MS)

      const browserMetrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation').at(0) as PerformanceNavigationTiming | undefined
        const state = (window as Window & { __pageVitalsLab?: { cls: number; lcpMs: number | null } }).__pageVitalsLab
        return {
          cls: state?.cls ?? null,
          deviceScaleFactor: window.devicePixelRatio,
          lcpMs: state?.lcpMs ?? null,
          ttfbMs: navigation ? navigation.responseStart - navigation.startTime : null,
          userAgent: navigator.userAgent,
          viewport: { height: window.innerHeight, width: window.innerWidth },
        }
      })
      const htmlTransferBytes = (await response.request().sizes()).responseBodySize

      expect(browserMetrics.lcpMs, `${route} should produce an LCP entry`).not.toBeNull()
      expect(browserMetrics.cls, `${route} should produce a CLS measure`).not.toBeNull()
      expect(browserMetrics.ttfbMs, `${route} should produce a navigation TTFB`).not.toBeNull()
      expect(htmlTransferBytes, `${route} should transfer HTML response bytes`).toBeGreaterThan(0)

      measurements.push({
        browserProject: testInfo.project.name,
        deviceScaleFactor: browserMetrics.deviceScaleFactor,
        htmlTransferBytes,
        lcpMs: round(browserMetrics.lcpMs as number, 1),
        cls: round(browserMetrics.cls as number, 4),
        route,
        sample,
        ttfbMs: round(browserMetrics.ttfbMs as number, 1),
        userAgent: browserMetrics.userAgent,
        viewport: browserMetrics.viewport,
      })
    }
  }

  const summaries = ROUTES.map((route) => {
    const routeMeasurements = measurements.filter((measurement) => measurement.route === route)
    return {
      route,
      samples: routeMeasurements.length,
      medianLcpMs: median(routeMeasurements.map((measurement) => measurement.lcpMs)),
      medianCls: median(routeMeasurements.map((measurement) => measurement.cls)),
      medianTtfbMs: median(routeMeasurements.map((measurement) => measurement.ttfbMs)),
      medianHtmlTransferBytes: median(routeMeasurements.map((measurement) => measurement.htmlTransferBytes)),
    }
  })

  console.log(
    `PAGE_VITALS_LAB ${JSON.stringify({
      environment: 'local production build with mocked GitHub API; analytics and avatar requests blocked',
      inp: 'not measured: lab run has no real-user interaction sample',
      measurements,
      summaries,
    })}`
  )

  expect(measurements).toHaveLength(ROUTES.length * REPEATS)
})

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0)
  return value
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
