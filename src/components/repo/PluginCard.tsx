'use client'

import type { components } from '@octokit/openapi-types'
import type { Plugin } from '../../app/types/plugin.type.ts'
import { Card, CardContent } from '../ui/card.tsx'
import { InstallCommand } from './InstallCommand.tsx'
import { PluginAuthor } from './PluginAuthor.tsx'
import { PluginDescription } from './PluginDescription.tsx'
import { PluginHeader } from './PluginHeader.tsx'
import { PluginId } from './PluginId.tsx'
import { PluginKeywords } from './PluginKeywords.tsx'
import { PluginList } from './PluginList.tsx'
import { PluginSource } from './PluginSource.tsx'

type Repository = components['schemas']['repository']

type PluginCardProps = {
  plugin: Plugin
  repoPath: string
  repo?: Repository | null
}

export function PluginCard({ plugin, repoPath, repo }: PluginCardProps) {
  return (
    <Card className="group w-full transition-all duration-300 hover:border-primary/30 hover:bg-linear-to-tl hover:from-muted hover:to-background">
      <PluginHeader category={plugin.category} name={plugin.name} version={plugin.version} />
      {plugin.name ? <InstallCommand pluginId={plugin.id} pluginName={plugin.name} repoPath={repoPath} /> : null}
      <CardContent className="space-y-2 pt-1">
        <PluginDescription description={plugin.description} />
        <PluginSource defaultBranch={repo?.default_branch} repoPath={repoPath} source={plugin.source} />
        <PluginAuthor author={plugin.author} />
        <PluginId id={plugin.id} />
        <PluginKeywords keywords={plugin.keywords} />
        <PluginList defaultBranch={repo?.default_branch} items={plugin.commands} repoPath={repoPath} title="Commands" />
        <PluginList defaultBranch={repo?.default_branch} items={plugin.agents} repoPath={repoPath} title="Agents" />
        <PluginList defaultBranch={repo?.default_branch} items={plugin.mcpServers} repoPath={repoPath} title="MCP Servers" />
      </CardContent>
    </Card>
  )
}
