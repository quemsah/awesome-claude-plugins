export const searchableRepoFields = ['repo_name', 'description', 'owner', 'repo_path', 'plugins_count_label']

export function getRepoPath(repo) {
  if (!(repo.owner && repo.repo_name)) {
    return ''
  }
  return `${repo.owner}/${repo.repo_name}`
}

export function getPluginCountLabel(repo) {
  if (repo.plugins_count === null || repo.plugins_count === undefined) {
    return ''
  }

  return `${repo.plugins_count} ${repo.plugins_count === 1 ? 'plugin' : 'plugins'}`
}

export function getRepoSearchFieldValue(repo, field) {
  switch (field) {
    case 'repo_path':
      return getRepoPath(repo)
    case 'plugins_count_label':
      return getPluginCountLabel(repo)
    default:
      return repo[field] ?? ''
  }
}

export function repoMatchesSearchField(repo, query) {
  const normalizedQuery = normalize(query)
  return searchableRepoFields.some((field) => normalize(String(getRepoSearchFieldValue(repo, field))).includes(normalizedQuery))
}

function normalize(value) {
  return value.toLowerCase().trim()
}
