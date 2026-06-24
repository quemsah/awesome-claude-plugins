import { useState } from 'react'
import { getPluginInstallCommand, isPluginInstallCommandVerified } from '../lib/installCommand.ts'

export function useInstallCommand(pluginName?: string, pluginId?: string, repoPath?: string) {
  const [isCopied, setIsCopied] = useState(false)

  const installCommand = getPluginInstallCommand({ pluginName, pluginId, repoPath })
  const isVerified = isPluginInstallCommandVerified(pluginId, repoPath)

  const handleCopyClick = async () => {
    if (!(installCommand && isVerified)) return

    try {
      await navigator.clipboard.writeText(installCommand)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 500)
    } catch {
      // clipboard write failed; leave isCopied as false
    }
  }

  return { getInstallCommand: () => installCommand, handleCopyClick, installCommand, isCopied, isVerified }
}
