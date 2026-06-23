import { useState } from 'react'
import { getPluginInstallCommand } from '../lib/installCommand.ts'

export function useInstallCommand(pluginName?: string, pluginId?: string, repoPath?: string) {
  const [isCopied, setIsCopied] = useState(false)

  const installCommand = getPluginInstallCommand({ pluginName, pluginId, repoPath })

  const handleCopyClick = () => {
    if (!installCommand) return

    navigator.clipboard.writeText(installCommand)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 500)
  }

  return { getInstallCommand: () => installCommand, handleCopyClick, installCommand, isCopied }
}
