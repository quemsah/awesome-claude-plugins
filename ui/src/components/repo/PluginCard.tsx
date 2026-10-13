import type { Plugin } from '../../app/types/plugin.type.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'
import { Card, CardContent } from '../ui/card.tsx'
import { InstallCommand } from './InstallCommand.tsx'
import { PluginAuthor } from './PluginAuthor.tsx'
import { PluginDescription } from './PluginDescription.tsx'
import { PluginHeader } from './PluginHeader.tsx'
import { PluginId } from './PluginId.tsx'
import { PluginKeywords } from './PluginKeywords.tsx'
import { PluginList } from './PluginList.tsx'
import { PluginSource } from './PluginSource.tsx'

const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

function getGitHubRepoPath(value?: string): string | undefined {
  if (!value) return undefined
  if (GITHUB_REPO_PATH_PATTERN.test(value)) return value

  try {
    const url = new URL(value)
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return undefined

    const [owner, repo, ...extraSegments] = url.pathname.split('/').filter(Boolean)
    const repoName = repo?.endsWith('.git') ? repo.slice(0, -4) : repo
    const repoPath = owner && repoName && !extraSegments.length ? [owner, repoName].join('/') : undefined
    return repoPath && GITHUB_REPO_PATH_PATTERN.test(repoPath) ? repoPath : undefined
  } catch {
    return undefined
  }
}

function getPluginComponentLocation(source: Plugin['source'], repoPath: string, defaultBranch?: string) {
  if (!source) return { repoPath, defaultBranch, pathPrefix: undefined }

  if (typeof source === 'string') {
    const externalRepo = source.startsWith('github:') ? source.slice('github:'.length) : undefined
    if (externalRepo && GITHUB_REPO_PATH_PATTERN.test(externalRepo)) {
      return { repoPath: externalRepo, defaultBranch: 'HEAD', pathPrefix: undefined }
    }

    return { repoPath, defaultBranch, pathPrefix: source }
  }

  const sourceRepo = source.repo ?? getGitHubRepoPath(source.url)
  return {
    repoPath: sourceRepo ?? repoPath,
    defaultBranch: source.sha ?? source.commit ?? source.ref ?? source.branch ?? (sourceRepo ? 'HEAD' : defaultBranch),
    pathPrefix: source.path ?? (source.source === 'github' || source.source === 'git-subdir' ? undefined : source.source),
  }
}

type PluginCardProps = {
  marketplaceName?: string
  plugin: Plugin
  repoPath: string
  repo?: GitHubRepository | null
}

export function PluginCard({ marketplaceName, plugin, repoPath, repo }: PluginCardProps) {
  const componentLocation = getPluginComponentLocation(plugin.source, repoPath, repo?.default_branch)

  return (
    <Card className="group w-full transition-all duration-300 hover:border-primary/30 hover:bg-linear-to-tl hover:from-muted hover:to-background">
      <PluginHeader category={plugin.category} name={plugin.name} version={plugin.version} />
      {plugin.name || plugin.id ? <InstallCommand marketplaceName={marketplaceName} pluginId={plugin.id} pluginName={plugin.name} /> : null}
      <CardContent className="pt-1">
        <dl className="space-y-2">
          <PluginDescription description={plugin.description} />
          <PluginSource defaultBranch={repo?.default_branch} repoPath={repoPath} source={plugin.source} />
          <PluginAuthor author={plugin.author} />
          <PluginId id={plugin.id} />
          <PluginKeywords keywords={plugin.keywords} />
          <PluginList
            defaultBranch={componentLocation.defaultBranch}
            items={plugin.commands}
            pathPrefix={componentLocation.pathPrefix}
            repoPath={componentLocation.repoPath}
            title="Commands"
          />
          <PluginList
            defaultBranch={componentLocation.defaultBranch}
            items={plugin.agents}
            pathPrefix={componentLocation.pathPrefix}
            repoPath={componentLocation.repoPath}
            title="Agents"
          />
          <PluginList
            defaultBranch={componentLocation.defaultBranch}
            items={plugin.mcpServers}
            pathPrefix={componentLocation.pathPrefix}
            repoPath={componentLocation.repoPath}
            title="MCP Servers"
          />
        </dl>
      </CardContent>
    </Card>
  )
}
