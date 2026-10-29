import { describe, expect, it } from 'vitest'
import { GET } from './route.ts'

describe('/SKILL.md', () => {
  it('binds marketplace installation to the audited pinned source', async () => {
    const response = GET()
    const guide = await response.text()

    expect(guide).toContain('git -C {local_path} checkout --detach {commit}')
    expect(guide).toContain('Confirm `rev-parse HEAD` equals the requested full commit SHA')
    expect(guide).toContain('audit that plugin at its own full commit SHA')
    expect(guide).toContain('Stop if any installed source cannot be bound to the revision you audited')
    expect(guide).toContain('/plugin marketplace add {absolute_local_path}')
    expect(guide).not.toContain('/plugin marketplace add {owner}/{repo}')
    expect(guide).toContain('obtain explicit approval before installing or running anything')
  })
})
