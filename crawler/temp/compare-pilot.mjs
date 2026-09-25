import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [repoRootArg, exportRootArg, outputRootArg] = process.argv.slice(2)
if (!repoRootArg || !exportRootArg || !outputRootArg) throw new Error('Usage: compare-pilot.mjs <repo-root> <export-root> <output-root>')

const repoRoot = resolve(repoRootArg)
const exportRoot = resolve(exportRootArg)
const outputRoot = resolve(outputRootArg)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const baselineRepos = readJson(join(repoRoot, 'ui/src/data/repos.json'))
const draftRepos = readJson(join(exportRoot, 'ui/src/data/repos.json'))
const baselineStats = readJson(join(repoRoot, 'ui/src/data/stats.json'))
const draftStats = readJson(join(exportRoot, 'ui/src/data/stats.json'))

function compareRows(before, after, keyOf, fields) {
  const oldRows = new Map(before.map((row) => [keyOf(row), row]))
  const newRows = new Map(after.map((row) => [keyOf(row), row]))
  const added = [...newRows].filter(([key]) => !oldRows.has(key)).map(([, row]) => row)
  const removed = [...oldRows].filter(([key]) => !newRows.has(key)).map(([, row]) => row)
  const changed = []

  for (const [key, next] of newRows) {
    const previous = oldRows.get(key)
    if (!previous) continue
    const differences = Object.fromEntries(
      fields
        .filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]))
        .map((field) => [field, { before: previous[field], after: next[field] }]),
    )
    if (Object.keys(differences).length) changed.push({ key, fields: differences })
  }

  return { added, removed, changed }
}

const repoDiff = compareRows(baselineRepos, draftRepos, (row) => row.html_url, [
  'stargazers_count',
  'forks_count',
  'subscribers_count',
  'description',
  'owner',
  'owner_url',
  'repo_name',
  'plugins_count',
])
const statsDiff = compareRows(baselineStats, draftStats, (row) => `${row.id}:${row.date}`, ['size'])
const readmeDiff = spawnSync('git', ['diff', '--no-index', '--', join(repoRoot, 'README.md'), join(exportRoot, 'README.md')], {
  cwd: repoRoot,
  encoding: 'utf8',
})
if (readmeDiff.error) throw readmeDiff.error
if (readmeDiff.status !== 0 && readmeDiff.status !== 1) throw new Error(readmeDiff.stderr || `git diff exited ${readmeDiff.status}`)

writeFileSync(join(outputRoot, 'README.diff'), readmeDiff.stdout || '(README files are identical)\n')
writeFileSync(join(outputRoot, 'repo-differences.json'), `${JSON.stringify(repoDiff, null, 2)}\n`)
writeFileSync(join(outputRoot, 'stats-differences.json'), `${JSON.stringify(statsDiff, null, 2)}\n`)

const report = [
  '# Local crawler comparison',
  '',
  `- README identical: ${readmeDiff.status === 0 ? 'yes' : 'no'}`,
  `- Repositories: checked-in ${baselineRepos.length}, draft ${draftRepos.length}`,
  `- Repository rows: ${repoDiff.added.length} added, ${repoDiff.removed.length} removed, ${repoDiff.changed.length} changed`,
  `- Stats rows: checked-in ${baselineStats.length}, draft ${draftStats.length}`,
  `- Stats rows: ${statsDiff.added.length} added, ${statsDiff.removed.length} removed, ${statsDiff.changed.length} changed`,
  '',
  'Detailed row-level JSON differences are in `repo-differences.json` and `stats-differences.json`; README changes are in `README.diff`.',
  '',
  'The pilot uses a fresh database, so removed baseline rows and reset statistics are expected. Compare crawl coverage and metadata against the checked-in catalog before drawing conclusions.',
  '',
]
writeFileSync(join(outputRoot, 'comparison.md'), report.join('\n'))
console.log(`Comparison written to ${join(outputRoot, 'comparison.md')}`)
