export function compareRepoQuality(a, b) {
  const scoreA = computeRepoQuality(a)
  const scoreB = computeRepoQuality(b)
  return scoreB - scoreA
}

function computeRepoQuality(repo) {
  const stars = repo.stargazers_count ?? 0
  const forks = repo.forks_count ?? 0
  const subs = repo.subscribers_count ?? 0
  const plugins = repo.plugins_count ?? 0

  return stars * 1 + forks * 2 + subs * 3 + plugins * 5
}
