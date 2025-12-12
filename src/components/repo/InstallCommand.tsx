import { useInstallCommand } from '../../hooks/useInstallCommand.ts'

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
          {isCopied ? (
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Copied</title>
              <polyline points="20,6 9,17 4,12" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Copy</title>
              <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
