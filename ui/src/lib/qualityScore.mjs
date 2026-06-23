const claudeEvidencePattern = /\b(claude|plugin|plugins|skill|skills|agent|agents|mcp|marketplace)\b/i
const broadProjectPattern = /\b(framework|cms|platform|database|security|slides|daily\.dev|backend)\b/i

export const qualityScoreWeights = {
  pluginCount: 28,
  claudeEvidence: 24,
  description: 12,
  stars: 20,
  forks: 8,
  broadProjectPenalty: -16,
}

export function getRepoQualityScore(repo) {
  const pluginCount = repo.plugins_count ?? 0
  const description = repo.description ?? ''
  const stars = repo.stargazers_count ?? 0
  const forks = repo.forks_count ?? 0
  const hasClaudeEvidence = claudeEvidencePattern.test(`${repo.repo_name ?? ''} ${description}`)
  const looksBroad = pluginCount <= 1 && broadProjectPattern.test(description) && !hasClaudeEvidence

  const score =
    getPluginCountScore(pluginCount) +
    (hasClaudeEvidence ? qualityScoreWeights.claudeEvidence : 0) +
    getDescriptionScore(description) +
    getPopularityScore(stars, qualityScoreWeights.stars) +
    getPopularityScore(forks, qualityScoreWeights.forks) +
    (looksBroad ? qualityScoreWeights.broadProjectPenalty : 0)

  return Math.round(score * 100) / 100
}

export function compareRepoQuality(a, b) {
  return (
    getRepoQualityScore(b) - getRepoQualityScore(a) ||
    (b.plugins_count ?? 0) - (a.plugins_count ?? 0) ||
    (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) ||
    String(a.owner ?? '').localeCompare(String(b.owner ?? '')) ||
    String(a.repo_name ?? '').localeCompare(String(b.repo_name ?? ''))
  )
}

function getPluginCountScore(pluginCount) {
  if (pluginCount <= 0) {
    return 0
  }

  return Math.min(qualityScoreWeights.pluginCount, 12 + Math.log2(pluginCount + 1) * 6)
}

function getDescriptionScore(description) {
  const trimmedDescription = description.trim()
  if (trimmedDescription.length >= 80) {
    return qualityScoreWeights.description
  }
  if (trimmedDescription.length >= 30) {
    return qualityScoreWeights.description / 2
  }
  return trimmedDescription ? 3 : 0
}

function getPopularityScore(count, maxScore) {
  return Math.min(maxScore, Math.log10(count + 1) * (maxScore / 5))
}
