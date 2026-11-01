import { useEffect, useRef, useState } from 'react'
import { trackCopyPluginInstall } from '../lib/analytics.ts'
import { copyText } from '../lib/clipboard.ts'
import {
  getDirectPluginInstallCommand,
  getPluginInstallCommand,
  isPluginInstallCommandVerified,
} from '../lib/installCommand.ts'

export type UseInstallCommandOptions = {
  pluginName?: string
  marketplaceName?: string
  pluginId?: string
  repoPath?: string
  owner?: string
  repoName?: string
}

/** Generates a verified one-step install command and manages copy feedback. */
export function useInstallCommand(options: UseInstallCommandOptions) {
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      clearTimeout(resetTimer.current)
    }
  }, [])

  const { pluginName, marketplaceName, pluginId, repoPath, owner, repoName } = options
  const [pathOwner, pathRepo] = (repoPath ?? '').split('/')
  const directCommand = getDirectPluginInstallCommand({
    pluginName,
    pluginId,
    owner: owner ?? pathOwner,
    repoName: repoName ?? pathRepo,
  })
  const fallbackCommand = getPluginInstallCommand({ pluginName, pluginId, marketplaceName })
  const installCommand = directCommand ?? fallbackCommand
  const isVerified = Boolean(directCommand) || isPluginInstallCommandVerified(pluginId ?? pluginName, marketplaceName)

  const handleCopyClick = async () => {
    if (!(installCommand && isVerified)) return
    const copied = await copyText(installCommand)
    if (!isMounted.current) return

    if (copied) {
      setCopyError(null)
      setIsCopied(true)
      trackCopyPluginInstall()
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => {
        if (isMounted.current) setIsCopied(false)
      }, 2_000)
    } else {
      setCopyError('Unable to copy the install command. Select and copy it manually.')
    }
  }

  return { copyError, handleCopyClick, installCommand, isCopied, isVerified, isDirectInstall: Boolean(directCommand) }
}
