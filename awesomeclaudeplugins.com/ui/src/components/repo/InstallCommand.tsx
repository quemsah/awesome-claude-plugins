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

export function InstallCommand({ marketplaceName, pluginName, pluginId, repoPath, owner, repoName }: InstallCommandProps) {
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
  } = useInstallCommand({
    marketplaceName,
    pluginName,
    pluginId,
    repoPath,
    owner,
    repoName,
  })

  const isPluginDisabled = !(installCommand && isVerified)

  if (!needsMarketplaceAdd) {
    return (
      <div className="px-6 pb-4">
        <div className="bg-muted/50 flex items-center gap-2 rounded-md border p-3">
          <code className="grow font-mono text-sm break-all">{installCommand ?? 'Install command unavailable'}</code>
          {installCommand && !isVerified && <span className="text-muted-foreground shrink-0 text-xs">unverified</span>}
          <button
            aria-label={
              isPluginCopied
                ? 'Installation command copied'
                : isPluginDisabled
                  ? 'Copy install command unavailable'
                  : 'Copy installation command'
            }
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
          {copyError ?? (isPluginCopied ? 'Install command copied.' : '')}
        </p>
      </div>
    )
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
              aria-label={
                isPluginCopied
                  ? 'Installation command copied'
                  : isPluginDisabled
                    ? 'Copy install command unavailable'
                    : 'Copy installation command'
              }
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
        {copyError ??
          (isBothCopied
            ? 'Both commands copied.'
            : isMarketplaceCopied
              ? 'Marketplace command copied.'
              : isPluginCopied
                ? 'Install command copied.'
                : '')}
      </p>
    </div>
  )
}
