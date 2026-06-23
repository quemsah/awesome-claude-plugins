export const categoryTaxonomy = [
  { value: 'agent-workflows', label: 'Agent workflows', terms: ['agent', 'agents', 'swarm', 'workflow', 'orchestration', 'automation'] },
  { value: 'mcp-integrations', label: 'MCP and integrations', terms: ['mcp', 'server', 'integration', 'connector', 'api'] },
  { value: 'skills-prompts', label: 'Skills and prompts', terms: ['skill', 'skills', 'prompt', 'prompts', 'command', 'template'] },
  { value: 'developer-tooling', label: 'Developer tooling', terms: ['code', 'review', 'testing', 'lint', 'git', 'cli'] },
  { value: 'knowledge-memory', label: 'Knowledge and memory', terms: ['memory', 'rag', 'context', 'knowledge', 'docs'] },
  {
    value: 'security-operations',
    label: 'Security and operations',
    terms: ['security', 'guardrail', 'compliance', 'monitoring', 'observability'],
  },
  { value: 'design-content', label: 'Design and content', terms: ['design', 'ui', 'slides', 'image', 'video'] },
]

export const keywordTaxonomy = [
  'claude',
  'mcp',
  'agent',
  'skill',
  'prompt',
  'workflow',
  'memory',
  'security',
  'design',
  'data',
  'testing',
  'review',
]

export function getRepoCategories(repo) {
  const text = getRepoFacetText(repo)
  return categoryTaxonomy.filter((category) => category.terms.some((term) => text.includes(term))).map((category) => category.value)
}

export function getRepoKeywords(repo) {
  const text = getRepoFacetText(repo)
  return keywordTaxonomy.filter((keyword) => text.includes(keyword))
}

export function filterReposByFacets(repos, filters) {
  return repos.filter((repo) => {
    const matchesCategory = !filters.category || getRepoCategories(repo).includes(filters.category)
    const matchesKeyword = !filters.keyword || getRepoKeywords(repo).includes(filters.keyword)
    return matchesCategory && matchesKeyword
  })
}

export function getCategoryOptions(repos) {
  return categoryTaxonomy.map((category) => ({
    value: category.value,
    label: category.label,
    count: repos.filter((repo) => getRepoCategories(repo).includes(category.value)).length,
  }))
}

export function getKeywordOptions(repos) {
  return keywordTaxonomy.map((keyword) => ({
    value: keyword,
    label: keyword,
    count: repos.filter((repo) => getRepoKeywords(repo).includes(keyword)).length,
  }))
}

function getRepoFacetText(repo) {
  return `${repo.owner ?? ''} ${repo.repo_name ?? ''} ${repo.description ?? ''}`.toLowerCase()
}
