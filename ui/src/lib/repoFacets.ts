import type { Repo } from '../schemas/repo.schema.ts'

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
] as const

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
] as const

export const verificationOptions = [
  { value: 'verified', label: 'Verified' },
  { value: 'unknown', label: 'Unknown' },
] as const

export const lifecycleOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
] as const

const languageKeywords = {
  python: ['python', 'py'],
  javascript: ['javascript', 'js', 'node', 'vue', 'react', 'nextjs', 'next'],
  typescript: ['typescript', 'ts', 'tsx'],
  java: ['java', 'spring'],
  go: ['golang', 'go'],
  rust: ['rust'],
  ruby: ['ruby', 'rails'],
  php: ['php'],
  csharp: ['csharp', 'c-sharp', 'dotnet', '.net'],
  cpp: ['cpp', 'c-plus-plus'],
  clojure: ['clojure'],
  elixir: ['elixir'],
  haskell: ['haskell'],
  scala: ['scala'],
  kotlin: ['kotlin'],
  swift: ['swift'],
  dart: ['dart'],
}

const languageDisplayNames: Record<keyof typeof languageKeywords, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  php: 'PHP',
  csharp: 'C#',
  cpp: 'C++',
  clojure: 'Clojure',
  elixir: 'Elixir',
  haskell: 'Haskell',
  scala: 'Scala',
  kotlin: 'Kotlin',
  swift: 'Swift',
  dart: 'Dart',
}

export function getRepoCategories(repo: Repo): string[] {
  const text = getRepoFacetText(repo)
  return categoryTaxonomy.filter((category) => category.terms.some((term) => text.includes(term))).map((category) => category.value)
}

export function getRepoKeywords(repo: Repo): string[] {
  const text = getRepoFacetText(repo)
  return keywordTaxonomy.filter((keyword) => text.includes(keyword))
}

export function getRepoVerificationStatus(repo: Repo): 'verified' | 'unknown' {
  return repo.plugins_count !== null ? 'verified' : 'unknown'
}

export function getRepoLifecycleState(repo: Repo): 'active' | 'inactive' {
  const stars = repo.stargazers_count ?? 0
  const subs = repo.subscribers_count ?? 0
  return stars > 0 || subs > 0 ? 'active' : 'inactive'
}

export function getRepoLanguage(repo: Repo): string | null {
  const name = repo.repo_name ? repo.repo_name.toLowerCase() : ''
  for (const [key, keywords] of Object.entries(languageKeywords) as [keyof typeof languageKeywords, string[]][]) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      return languageDisplayNames[key] || key
    }
  }
  return null
}

export function filterReposByFacets(repos: Repo[], filters: { category?: string; keyword?: string; verification?: string; lifecycle?: string; language?: string }): Repo[] {
  return repos.filter((repo) => {
    const matchesCategory = !filters.category || getRepoCategories(repo).includes(filters.category)
    const matchesKeyword = !filters.keyword || getRepoKeywords(repo).includes(filters.keyword)
    const matchesVerification = !filters.verification || getRepoVerificationStatus(repo) === filters.verification
    const matchesLifecycle = !filters.lifecycle || getRepoLifecycleState(repo) === filters.lifecycle
    const matchesLanguage = !filters.language || getRepoLanguage(repo) === filters.language
    return matchesCategory && matchesKeyword && matchesVerification && matchesLifecycle && matchesLanguage
  })
}

export function getCategoryOptions(repos: Repo[]): { value: string; label: string; count: number }[] {
  return categoryTaxonomy.map((category) => ({
    value: category.value,
    label: category.label,
    count: repos.filter((repo) => getRepoCategories(repo).includes(category.value)).length,
  }))
}

export function getKeywordOptions(repos: Repo[]): { value: string; label: string; count: number }[] {
  return keywordTaxonomy.map((keyword) => ({
    value: keyword,
    label: keyword,
    count: repos.filter((repo) => getRepoKeywords(repo).includes(keyword)).length,
  }))
}

export function getVerificationOptions(repos: Repo[]): { value: string; label: string; count: number }[] {
  return verificationOptions.map((option) => ({
    value: option.value,
    label: option.label,
    count: repos.filter((repo) => getRepoVerificationStatus(repo) === option.value).length,
  }))
}

export function getLifecycleOptions(repos: Repo[]): { value: string; label: string; count: number }[] {
  return lifecycleOptions.map((option) => ({
    value: option.value,
    label: option.label,
    count: repos.filter((repo) => getRepoLifecycleState(repo) === option.value).length,
  }))
}

export function getLanguageOptions(repos: Repo[]): { value: string; label: string; count: number }[] {
  const languages = new Map<string, number>()
  repos.forEach((repo) => {
    const lang = getRepoLanguage(repo)
    if (lang) {
      languages.set(lang, (languages.get(lang) || 0) + 1)
    }
  })
  return [...languages.entries()]
    .map(([label, count]) => ({ value: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function getRepoFacetText(repo: Repo): string {
  return `${repo.owner ?? ''} ${repo.repo_name ?? ''} ${repo.description ?? ''}`.toLowerCase()
}
