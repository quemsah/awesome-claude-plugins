'use client'

import { useInstallCommand } from '../../hooks/useInstallCommand.ts'
import { CopiedIcon } from '../common/CopiedIcon.tsx'
import { CopyIcon } from '../common/CopyIcon.tsx'

interface InstallCommandProps {
  marketplaceName?: string
  pluginName?: string
  pluginId?: string
  repoPath?: string
  owner?: string
  repoName?: string
}

interface SingleInstallCommandProps {
  copyError: string | null
  handleCopyPlugin: () => void
  installCommand: string | null
  isPluginCopied: boolean
  isPluginDisabled: boolean
  isVerified: boolean
}

function SingleInstallCommand({
  copyError,
  handleCopyPlugin,
  installCommand,
  isPluginCopied,
  isPluginDisabled,
  isVerified,
}: SingleInstallCommandProps) {
  const copyLabel = isPluginCopied
    ? 'Installation command copied'
    : isPluginDisabled
      ? 'Copy install command unavailable'
      : 'Copy installation command'

  const copyStatusMessage = copyError ?? (isPluginCopied ? 'Install command copied.' : '')

  return (
    <div className="px-6 pb-4">
      <div className="bg-muted/50 flex items-center gap-2 rounded-md border p-3">
        <code className="grow font-mono text-sm break-all">{installCommand ?? 'Install command unavailable'}</code>
        {installCommand && !isVerified && <span className="text-muted-foreground shrink-0 text-xs">unverified</span>}
        <button
          aria-label={copyLabel}
          className={`touch-target shrink-0 rounded-md p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isPluginCopied ? 'bg-status-positive/20 text-status-positive' : 'enabled:hover:bg-muted'
          }`}
          disabled={isPluginDisabled}
          onClick={handleCopyPlugin}
          title={isVerified ? 'Copy installation command' : 'Unverified command'}
          type="button"
        >
          {isPluginCopied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      </div>
      <p aria-live="polite" className="text-destructive mt-2 text-xs" role={copyError ? 'alert' : undefined}>
        {copyStatusMessage}
      </p>
    </div>
  )
}

interface TwoStepInstallCommandProps {
  combinedCommand: string | null
  copyError: string | null
  handleCopyBoth: () => void
  handleCopyMarketplace: () => void
  handleCopyPlugin: () => void
  installCommand: string | null
  isBothCopied: boolean
  isMarketplaceCopied: boolean
  isPluginCopied: boolean
  isPluginDisabled: boolean
  isVerified: boolean
  marketplaceAddCommand: string | null
}

function TwoStepInstallCommand({
  combinedCommand,
  copyError,
  handleCopyBoth,
  handleCopyMarketplace,
  handleCopyPlugin,
  installCommand,
  isBothCopied,
  isMarketplaceCopied,
  isPluginCopied,
  isPluginDisabled,
  isVerified,
  marketplaceAddCommand,
}: TwoStepInstallCommandProps) {
  const pluginCopyLabel = isPluginCopied
    ? 'Installation command copied'
    : isPluginDisabled
      ? 'Copy install command unavailable'
      : 'Copy installation command'

  let feedbackMessage = copyError ?? ''
  if (!feedbackMessage) {
    if (isBothCopied) {
      feedbackMessage = 'Both commands copied.'
    } else if (isMarketplaceCopied) {
      feedbackMessage = 'Marketplace command copied.'
    } else if (isPluginCopied) {
      feedbackMessage = 'Install command copied.'
    }
  }

  return (
    <div className="px-6 pb-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-medium">Installation steps:</span>
          {combinedCommand ? (
            <button
              aria-label={isBothCopied ? 'Both installation commands copied' : 'Copy both commands'}
              className={`touch-target inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                isBothCopied
                  ? 'border-status-positive/40 bg-status-positive/15 text-status-positive'
                  : 'border-border bg-background hover:bg-muted text-foreground'
              }`}
              onClick={handleCopyBoth}
              title="Copy both commands (/plugin marketplace add & /plugin install)"
              type="button"
            >
              {isBothCopied ? <CopiedIcon /> : <CopyIcon />}
              <span>{isBothCopied ? 'Copied both' : 'Copy both commands'}</span>
            </button>
          ) : null}
        </div>

        {/* Step 1: Add marketplace */}
        <div className="space-y-1">
          <div className="text-muted-foreground flex items-center justify-between px-0.5 text-xs">
            <span className="text-foreground/80 font-semibold">Step 1: Add marketplace</span>
          </div>
          <div className="bg-muted/50 flex items-center gap-2 rounded-md border p-2.5 sm:p-3">
            <code className="grow font-mono text-sm break-all">{marketplaceAddCommand}</code>
            <button
              aria-label={isMarketplaceCopied ? 'Marketplace add command copied' : 'Copy marketplace add command'}
              className={`touch-target shrink-0 rounded-md p-1 transition-colors ${
                isMarketplaceCopied ? 'bg-status-positive/20 text-status-positive' : 'hover:bg-muted'
              }`}
              onClick={handleCopyMarketplace}
              title="Copy marketplace add command"
              type="button"
            >
              {isMarketplaceCopied ? <CopiedIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>

        {/* Step 2: Install plugin */}
        <div className="space-y-1">
          <div className="text-muted-foreground flex items-center justify-between px-0.5 text-xs">
            <span className="text-foreground/80 font-semibold">Step 2: Install plugin</span>
            {installCommand && !isVerified && <span className="text-muted-foreground text-xs">unverified</span>}
          </div>
          <div className="bg-muted/50 flex items-center gap-2 rounded-md border p-2.5 sm:p-3">
            <code className="grow font-mono text-sm break-all">{installCommand ?? 'Install command unavailable'}</code>
            <button
              aria-label={pluginCopyLabel}
              className={`touch-target shrink-0 rounded-md p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isPluginCopied ? 'bg-status-positive/20 text-status-positive' : 'enabled:hover:bg-muted'
              }`}
              disabled={isPluginDisabled}
              onClick={handleCopyPlugin}
              title={isVerified ? 'Copy installation command' : 'Unverified command'}
              type="button"
            >
              {isPluginCopied ? <CopiedIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="text-destructive mt-2 text-xs" role={copyError ? 'alert' : undefined}>
        {feedbackMessage}
      </p>
    </div>
  )
}

export function InstallCommand(props: InstallCommandProps) {
  const {
    combinedCommand,
    copyError,
    handleCopyBoth,
    handleCopyMarketplace,
    handleCopyPlugin,
    installCommand,
    isBothCopied,
    isMarketplaceCopied,
    isPluginCopied,
    isVerified,
    marketplaceAddCommand,
    needsMarketplaceAdd,
  } = useInstallCommand(props)

  const isPluginDisabled = !(installCommand && isVerified)

  if (!needsMarketplaceAdd) {
    return (
      <SingleInstallCommand
        copyError={copyError}
        handleCopyPlugin={handleCopyPlugin}
        installCommand={installCommand}
        isPluginCopied={isPluginCopied}
        isPluginDisabled={isPluginDisabled}
        isVerified={isVerified}
      />
    )
  }

  return (
    <TwoStepInstallCommand
      combinedCommand={combinedCommand}
      copyError={copyError}
      handleCopyBoth={handleCopyBoth}
      handleCopyMarketplace={handleCopyMarketplace}
      handleCopyPlugin={handleCopyPlugin}
      installCommand={installCommand}
      isBothCopied={isBothCopied}
      isMarketplaceCopied={isMarketplaceCopied}
      isPluginCopied={isPluginCopied}
      isPluginDisabled={isPluginDisabled}
      isVerified={isVerified}
      marketplaceAddCommand={marketplaceAddCommand}
    />
  )
}
