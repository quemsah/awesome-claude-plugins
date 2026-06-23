import { useState } from 'react'
import { getInstallCommand } from '../lib/installCommand.ts'

export function useInstallCommand(pluginName?: string, pluginId?: string, repoPath?: string) {
  const [isCopied, setIsCopied] = useState(false)

  const getCommand = () => getInstallCommand(pluginName, pluginId, repoPath)

  const handleCopyClick = () => {
    const command = getCommand()
    navigator.clipboard.writeText(command)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 500)
  }

  return { getInstallCommand: getCommand, handleCopyClick, isCopied }
}
