import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard.ts'
import { getPluginInstallCommand, isPluginInstallCommandVerified } from '../lib/installCommand.ts'

export function useInstallCommand(pluginName?: string, pluginId?: string, repoPath?: string) {
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const installCommand = getPluginInstallCommand({ pluginName, pluginId, repoPath })
  const isVerified = isPluginInstallCommandVerified(pluginId, repoPath)

  const handleCopyClick = async () => {
    if (!(installCommand && isVerified)) return

    const copied = await copyText(installCommand)
    if (copied) {
      setCopyError(null)
      setIsCopied(true)
      // Restart rather than stack: a second copy while the first countdown runs would otherwise be
      // cut short by the older timer, dropping the confirmation before its two seconds are up.
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setIsCopied(false), 2_000)
    } else {
      setCopyError('Unable to copy the install command. Select and copy it manually.')
    }
  }

  return { copyError, getInstallCommand: () => installCommand, handleCopyClick, installCommand, isCopied, isVerified }
}
