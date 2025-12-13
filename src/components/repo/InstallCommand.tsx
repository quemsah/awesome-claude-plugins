import { useInstallCommand } from '../../hooks/useInstallCommand.ts'
import { CopiedIcon } from '../common/CopiedIcon.tsx'
import { CopyIcon } from '../common/CopyIcon.tsx'

interface InstallCommandProps {
  pluginName?: string
  pluginId?: string
  repoPath: string
}

export function InstallCommand({ pluginName, pluginId, repoPath }: InstallCommandProps) {
  const { getInstallCommand, handleCopyClick, isCopied } = useInstallCommand(pluginName, pluginId, repoPath)

  return (
    <div className="px-6 pb-4">
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
        <code className="flex-grow break-all font-mono text-sm">{getInstallCommand()}</code>
        <button
          aria-label={isCopied ? 'Installation command copied' : 'Copy installation command'}
          className={`flex-shrink-0 rounded-md p-1 transition-colors ${isCopied ? 'bg-green-500/20 text-green-600' : 'hover:bg-muted'}`}
          onClick={handleCopyClick}
          title={isCopied ? 'Installation command copied' : 'Copy installation command'}
          type="button"
        >
          {isCopied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  )
}
