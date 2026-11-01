import { describe, expect, it } from 'vitest'
import { GET } from './route.ts'

describe('/SKILL.md', () => {
  it('binds marketplace installation to the audited pinned source', async () => {
    const response = GET()
    const guide = await response.text()

    expect(guide).toContain('git -C {local_path} checkout --detach {commit}')
    expect(guide).toContain('Confirm `rev-parse HEAD` equals the requested full commit SHA')
    expect(guide).toContain('git -C {absolute_local_path} status --porcelain --untracked-files=all --ignored --ignore-submodules=none')
    expect(guide).toContain('Repeat the commit and clean-status checks inside every submodule')
    expect(guide).toContain('Stop if any submodule is missing, changed, or unaudited')
    expect(guide).toContain(
      'recheck the local checkout immediately before registering it and again immediately before installing the plugin'
    )
    expect(guide).toContain(
      'Require the first command to equal the original audited full commit SHA and the second command to print nothing'
    )
    expect(guide).toContain('audit that plugin at its own full commit SHA')
    expect(guide).toContain('Stop if any installed source cannot be bound to the revision you audited')
    expect(guide).toContain('/plugin marketplace add {absolute_local_path}')
    expect(guide).not.toContain('/plugin marketplace add {owner}/{repo}')
    expect(guide).toContain('obtain explicit approval before installing or running anything')
    expect(guide).toContain('Claude Code does not install their Node.js dependencies into the checkout')
    expect(guide).toContain('its runtime actually loads them there')
    expect(guide).toContain('stop and request a supported installation method rather than bypassing the clean-check requirement')
    expect(guide).toContain('before every session start or reload')
    expect(guide).toContain(
      'Do not load changed source or dependency artifacts without reviewing the changes and obtaining renewed approval'
    )
  })
  it('does not make standalone agents clone an unpinned HEAD after auditing a commit', async () => {
    const guide = await GET().text()
    const step5 = guide.split('### Step 5: Install after approval')[1]?.split('## Catalog API Specification')[0]

    expect(step5).toBeDefined()
    expect(step5).toContain('Treat the clone-and-load examples on the detail page and in Markdown as reference only')
    expect(step5).toContain('Reuse the already-audited checkout')
    expect(step5).toContain('git -C {absolute_local_path} rev-parse HEAD')
    expect(step5).toContain('git -C {absolute_local_path} status --porcelain --untracked-files=all --ignored --ignore-submodules=none')
    expect(step5).toContain('claude --plugin-dir {absolute_local_path}')
    expect(step5).toContain('Do not clone again or run the marketplace commands below')
    expect(step5).not.toContain('git clone https://github.com/')
  })
})
