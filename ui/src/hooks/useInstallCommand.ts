import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard.ts'
import { getPluginInstallCommand, isPluginInstallCommandVerified } from '../lib/installCommand.ts'

export function useInstallCommand(pluginName?: string, pluginId?: string, marketplaceName?: string) {
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

  const installCommand = getPluginInstallCommand({ pluginName, pluginId, marketplaceName })
  const isVerified = isPluginInstallCommandVerified(pluginId, marketplaceName)

  const handleCopyClick = async () => {
    if (!(installCommand && isVerified)) return

    const copied = await copyText(installCommand)
    if (!isMounted.current) return

    if (copied) {
      setCopyError(null)
      setIsCopied(true)
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setIsCopied(false), 2_000)
    } else {
      setCopyError('Unable to copy the install command. Select and copy it manually.')
    }
  }

  return { copyError, getInstallCommand: () => installCommand, handleCopyClick, installCommand, isCopied, isVerified }
}
