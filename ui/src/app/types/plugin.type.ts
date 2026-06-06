export type PluginAuthor = {
  name?: string
  email?: string
}

export type PluginSource = {
  source: string
  repo: string
}

export type Plugin = {
  name?: string
  description?: string
  version?: string
  id?: string
  source?: string | PluginSource
  category?: string
  author?: PluginAuthor
  license?: string
  keywords?: string[]
  strict?: boolean
  commands?: string[]
  agents?: string[]
  mcpServers?: string[]
}
