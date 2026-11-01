'use client'

import { useState } from 'react'
import { copyText } from '../../lib/clipboard.ts'
import { getStandalonePluginLoadInstructions } from '../../lib/standalonePluginInstructions.ts'

export function StandalonePluginLoad({ owner, repoName }: { owner: string; repoName: string }) {
  const instructions = getStandalonePluginLoadInstructions(owner, repoName)
  const [message, setMessage] = useState('')
  if (!instructions) return null
  return (
    <div className="px-6 pb-4">
      <h3 className="mb-2 font-semibold">Load locally</h3>
      <p className="text-muted-foreground mb-3 text-sm">Loads the plugin for this Claude Code session.</p>
      <pre className="bg-muted/50 overflow-x-auto rounded-md border p-3 text-sm">
        <code>{instructions}</code>
      </pre>
      <button
        className="mt-3 rounded-md border px-3 py-2 text-sm"
        onClick={async () =>
          setMessage(
            (await copyText(instructions)) ? 'Local loading instructions copied.' : 'Unable to copy. Select the instructions above.'
          )
        }
        type="button"
      >
        Copy local loading instructions
      </button>
      <p aria-live="polite" className="text-muted-foreground mt-2 text-xs">
        {message}
      </p>
      <a className="text-sm underline" href={`https://github.com/${owner}/${repoName}#readme`} rel="noopener noreferrer" target="_blank">
        Read the author's instructions
      </a>
    </div>
  )
}
