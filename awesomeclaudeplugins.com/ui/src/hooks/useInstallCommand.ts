import { useEffect, useRef, useState } from 'react'
import { trackCopyMarketplaceAdd, trackCopyPluginInstall } from '../lib/analytics.ts'
import { copyText } from '../lib/clipboard.ts'
import {
  getCombinedInstallCommand,
  getMarketplaceAddCommand,
  getPluginInstallCommand,
  isOfficialMarketplace,
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

export type CopiedCommandTarget = 'plugin' | 'marketplace' | 'both' | null

export function useInstallCommand(
  pluginNameOrOptions?: string | UseInstallCommandOptions,
  marketplaceNameParam?: string,
  pluginIdParam?: string,
  repoPathParam?: string,
  ownerParam?: string,
  repoNameParam?: string
) {
  const [copiedTarget, setCopiedTarget] = useState<CopiedCommandTarget>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isMounted = useRef(true)

  const options: UseInstallCommandOptions =
    typeof pluginNameOrOptions === 'object' && pluginNameOrOptions !== null
      ? pluginNameOrOptions
      : {
          pluginName: pluginNameOrOptions,
          marketplaceName: marketplaceNameParam,
          pluginId: pluginIdParam,
          repoPath: repoPathParam,
          owner: ownerParam,
          repoName: repoNameParam,
        }

  const { pluginName, marketplaceName, pluginId, repoPath, owner, repoName } = options

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      clearTimeout(resetTimer.current)
    }
  }, [])

  const installCommand = getPluginInstallCommand({ pluginName, marketplaceName, pluginId })
  const isVerified = isPluginInstallCommandVerified(pluginId ?? pluginName, marketplaceName)

  const [derivedOwner, derivedRepo] = (repoPath ?? '').split('/')
  const effectiveOwner = owner ?? derivedOwner
  const effectiveRepoName = repoName ?? derivedRepo

  const isOfficial = isOfficialMarketplace({
    owner: effectiveOwner,
    repoName: effectiveRepoName,
    marketplaceName,
    repoPath,
  })

  const rawMarketplaceAddCommand = getMarketplaceAddCommand(effectiveOwner, effectiveRepoName)
  // Step 1 is required for third-party / external marketplaces with valid add commands
  const needsMarketplaceAdd = Boolean(!isOfficial && marketplaceName && rawMarketplaceAddCommand)
  const marketplaceAddCommand = needsMarketplaceAdd ? rawMarketplaceAddCommand : null

  const combinedCommand = getCombinedInstallCommand(marketplaceAddCommand, installCommand)

  const copyWithFeedback = async (text: string | null, target: 'plugin' | 'marketplace' | 'both', onTrack: () => void) => {
    if (!text) return
    const copied = await copyText(text)
    if (!isMounted.current) return

    if (copied) {
      setCopyError(null)
      setCopiedTarget(target)
      onTrack()
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => {
        if (isMounted.current) setCopiedTarget(null)
      }, 2_000)
    } else {
      setCopyError('Unable to copy the command. Select and copy it manually.')
    }
  }

  const handleCopyPlugin = async () => {
    if (!(installCommand && isVerified)) return
    await copyWithFeedback(installCommand, 'plugin', () => trackCopyPluginInstall())
  }

  const handleCopyMarketplace = async () => {
    if (!marketplaceAddCommand) return
    await copyWithFeedback(marketplaceAddCommand, 'marketplace', () => trackCopyMarketplaceAdd())
  }

  const handleCopyBoth = async () => {
    if (!combinedCommand) return
    await copyWithFeedback(combinedCommand, 'both', () => {
      trackCopyMarketplaceAdd()
      trackCopyPluginInstall()
    })
  }

  return {
    combinedCommand,
    copiedTarget,
    copyError,
    getInstallCommand: () => installCommand,
    handleCopyBoth,
    handleCopyClick: handleCopyPlugin,
    handleCopyMarketplace,
    handleCopyPlugin,
    installCommand,
    isBothCopied: copiedTarget === 'both',
    isCopied: copiedTarget === 'plugin' || copiedTarget === 'both',
    isMarketplaceCopied: copiedTarget === 'marketplace',
    isOfficial,
    isPluginCopied: copiedTarget === 'plugin',
    isVerified,
    marketplaceAddCommand,
    needsMarketplaceAdd,
  }
}
