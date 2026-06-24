import { useInstallCommand } from '../../hooks/useInstallCommand.ts'
import { CopiedIcon } from '../common/CopiedIcon.tsx'
import { CopyIcon } from '../common/CopyIcon.tsx'

interface InstallCommandProps {
  pluginName?: string
  pluginId?: string
  repoPath: string
}

export function InstallCommand({ pluginName, pluginId, repoPath }: InstallCommandProps) {
  const { handleCopyClick, installCommand, isCopied, isVerified } = useInstallCommand(pluginName, pluginId, repoPath)

  return (
    <div className="px-6 pb-4">
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
        <code className="grow break-all font-mono text-sm">{installCommand ?? 'Install command unavailable'}</code>
        {installCommand && !isVerified && <span className="shrink-0 text-muted-foreground text-xs">unverified</span>}
        <button
          aria-label={isCopied ? 'Installation command copied' : 'Copy installation command'}
          className={`shrink-0 rounded-md p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isCopied ? 'bg-green-500/20 text-green-600' : isVerified ? 'hover:bg-muted' : 'cursor-not-allowed opacity-50'}`}
          disabled={!(installCommand && isVerified)}
          onClick={handleCopyClick}
          title={isVerified ? 'Copy installation command' : 'Unverified command'}
          type="button"
        >
          {isCopied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  )
}
