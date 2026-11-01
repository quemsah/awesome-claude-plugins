import { isGitHubSegment } from './repositoryIdentity.ts'

export function getStandalonePluginLoadInstructions(owner?: string | null, repoName?: string | null): string | null {
  if (!(typeof owner === 'string' && typeof repoName === 'string' && isGitHubSegment(owner) && isGitHubSegment(repoName))) return null
  return `git clone https://github.com/${owner}/${repoName}.git ./${repoName}\nclaude --plugin-dir ./${repoName}`
}
