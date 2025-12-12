export type PluginAuthor = {
  name?: string
  email?: string
}

export type Plugin = {
  name?: string
  description?: string
  version?: string
  id?: string
  source?: string
  category?: string
  author?: PluginAuthor
  license?: string
  keywords?: string[]
  strict?: boolean
  commands?: string[]
  agents?: string[]
  mcpServers?: string[]
}
