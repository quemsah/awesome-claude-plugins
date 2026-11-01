/** biome-ignore-all lint/style/useNamingConvention: Environment variables require uppercase names. */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const pidPattern = /^\d+$/
const parentPattern = /^PPid:\s*(\d+)/m
const rssPattern = /^VmRSS:\s*(\d+)/m

const { values } = parseArgs({
  options: {
    cwd: { type: 'string' },
    label: { type: 'string' },
    first: { type: 'string', default: 'api' },
    out: { type: 'string' },
    baseline: { type: 'string' },
    candidate: { type: 'string' },
  },
})
if (values.baseline || values.candidate) {
  assert(values.baseline && values.candidate, 'Both baseline and candidate are required')
  const load = (paths) => paths.split(',').map((path) => JSON.parse(readFileSync(path, 'utf8')))
  const base = load(values.baseline)
  const pr = load(values.candidate)
  const metrics = [
    ['First response (ms)', 'firstResponseMs'],
    ['Second response (ms)', 'secondResponseMs'],
    ['RSS after first (MiB)', 'rssAfterFirstMiB'],
    ['RSS after second (MiB)', 'rssAfterSecondMiB'],
    ['Sampled peak RSS (MiB)', 'sampledPeakRssMiB'],
  ]
  const lines = ['## Next.js production cold-start A/B', '']
  for (const first of ['api', 'home']) {
    const mainRun = base.find((entry) => entry.first === first)
    const prRun = pr.find((entry) => entry.first === first)
    assert(mainRun && prRun, 'Missing measurements for ' + first)
    lines.push('### ' + first + ' first', '', '| Metric | main | PR | PR - main |', '| --- | ---: | ---: | ---: |')
    for (const [name, key] of metrics) {
      const a = mainRun[key]
      const b = prRun[key]
      lines.push('| ' + name + ' | ' + a.toFixed(1) + ' | ' + b.toFixed(1) + ' | ' + (b - a).toFixed(1) + ' |')
    }
    lines.push('')
  }
  lines.push(
    'Node 24, built Next.js, fresh server per route, same GitHub Actions runner.',
    'First response includes startup and lazy route initialization; this is not index time alone.',
    'RSS sums Linux process-tree resident sizes and may double-count shared pages.',
    'Peak RSS is sampled every 250 ms and may miss brief spikes. Not Railway billing data.',
    ''
  )
  const output = lines.join('\n')
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, output)
} else {
  assert(values.cwd && values.label && values.out, 'Specify --cwd, --label and --out')
  assert(['api', 'home'].includes(values.first), 'Invalid first route')
  assert(process.platform === 'linux', 'Process-tree RSS sampling requires Linux')
  const cwd = resolve(values.cwd)
  const resolver = createRequire(resolve(cwd, 'package.json'))
  const nextBin = resolve(dirname(resolver.resolve('next/package.json')), 'dist/bin/next')
  const url = 'http://127.0.0.1:39425'
  const routes = { api: '/api/catalog?q=superpowers&view=cards', home: '/' }
  const first = values.first
  const second = first === 'api' ? 'home' : 'api'
  const server = spawn(process.execPath, [nextBin, 'start', '-p', '39425', '--hostname', '127.0.0.1'], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
  })
  let logs = ''
  let spawnError = null
  server.on('error', (error) => {
    spawnError = error
  })
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => {
      logs = (logs + chunk.toString()).slice(-8000)
    })
  }

  // Follow PPid recursively; Next.js can use child processes.
  const readRssMiB = () => {
    const entries = new Map()
    for (const name of readdirSync('/proc')) {
      if (!pidPattern.test(name)) continue
      try {
        const status = readFileSync('/proc/' + name + '/status', 'utf8')
        const parent = Number(status.match(parentPattern)?.[1])
        const rssKiB = Number(status.match(rssPattern)?.[1] ?? 0)
        entries.set(Number(name), { parent, rssKiB })
      } catch {
        // A process may exit while inspecting /proc.
      }
    }
    const descendants = new Set([server.pid])
    let pending = true
    while (pending) {
      pending = false
      for (const [pid, entry] of entries) {
        if (!descendants.has(pid) && descendants.has(entry.parent)) {
          descendants.add(pid)
          pending = true
        }
      }
    }
    const rssKiB = [...descendants].reduce((sum, pid) => sum + (entries.get(pid)?.rssKiB ?? 0), 0)
    return Math.round((rssKiB / 1024) * 10) / 10
  }
  let sampledPeakRssMiB = 0
  const sample = () => {
    const rss = readRssMiB()
    sampledPeakRssMiB = Math.max(sampledPeakRssMiB, rss)
    return rss
  }
  const timer = setInterval(sample, 250)
  const request = async (route, timeout) => {
    const response = await fetch(url + routes[route], { signal: AbortSignal.timeout(timeout) })
    assert(response.status === 200, route + ' returned HTTP ' + response.status)
    if (route === 'api') {
      const payload = await response.json()
      assert(payload.total > 0, 'Known-hit API search returned zero matches')
    } else {
      await response.text()
    }
  }
  const start = performance.now()
  try {
    let lastError = ''
    while (true) {
      assert(!spawnError, 'Next.js spawn error: ' + spawnError)
      assert(server.exitCode === null, 'Next.js exited before responding: ' + logs)
      if (performance.now() - start > 120_000) throw new Error('Cold-start timeout: ' + lastError + '\n' + logs)
      try {
        await request(first, 15_000)
        break
      } catch (error) {
        lastError = String(error)
        await delay(150)
      }
    }
    const firstResponseMs = Math.round(performance.now() - start)
    const rssAfterFirstMiB = sample()
    const secondStart = performance.now()
    await request(second, 30_000)
    const secondResponseMs = Math.round(performance.now() - secondStart)
    await delay(300)
    const rssAfterSecondMiB = sample()
    const report = {
      label: values.label,
      first,
      firstResponseMs,
      secondResponseMs,
      rssAfterFirstMiB,
      rssAfterSecondMiB,
      sampledPeakRssMiB,
    }
    writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally {
    clearInterval(timer)
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        // Already stopped.
      }
      if (server.exitCode === null) {
        await Promise.race([new Promise((done) => server.once('exit', done)), delay(3000)])
      }
      try {
        process.kill(-server.pid, 'SIGKILL')
      } catch {
        // Already stopped.
      }
    }
  }
}
