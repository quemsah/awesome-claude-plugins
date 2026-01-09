import { useState } from 'react'

export function useInstallCommand(pluginName?: string, pluginId?: string, repoPath?: string) {
  const [isCopied, setIsCopied] = useState(false)

  const getInstallCommand = () => {
    const normalizedName = pluginName?.toLowerCase().replace(/\s+/g, '-') || ''
    const suffix = pluginId ? `@${pluginId}` : repoPath ? `@${repoPath.replace('/', '-')}` : ''
    return `/plugin install ${normalizedName}${suffix}`
  }

  const handleCopyClick = () => {
    const command = getInstallCommand()
    navigator.clipboard.writeText(command)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 500)
  }

  return { getInstallCommand, handleCopyClick, isCopied }
}
