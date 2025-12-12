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
      <div className="bg-muted/50 rounded-md p-3 border flex items-center gap-2">
        <code className="text-sm font-mono break-all flex-grow">{getInstallCommand()}</code>
        <button
          aria-label={isCopied ? 'Installation command copied' : 'Copy installation command'}
          className={`p-1 rounded-md transition-colors flex-shrink-0 ${isCopied ? 'bg-green-500/20 text-green-600' : 'hover:bg-muted'}`}
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
