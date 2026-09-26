import { expect, it } from 'vitest'
import type { PublishableRepository } from '../storage/repositories.js'
import { renderReadme } from './readme.js'

function repo(id: number, stars: number, subscribers: number | null, description: string | null = null): PublishableRepository {
  return {
    id,
    html_url: `https://github.com/owner/repo-${id}`,
    repo_name: `repo-${id}`,
    owner: 'owner',
    owner_url: 'https://github.com/owner',
    stargazers_count: stars,
    subscribers_count: subscribers,
    forks_count: 0,
    plugins_count: null,
    description,
  }
}

it('escapes table-breaking description characters without altering input or inventing backslashes', () => {
  const repositories = [repo(2, 4, null, 'A | slash \\| *bold*\n[link](url)'), repo(1, 9, 5)]
  const original = structuredClone(repositories)
  expect(renderReadme(repositories, { id: 304, date: '2026-09-23T23:59:59.999Z', size: 2 })).toBe(
    '# Awesome Claude Code Plugins: Top 100 Repositories\n\n' +
      '> Last updated: 23.09.2026 with 2 total repositories indexed.\n\n' +
      '| # | Repo Name | Description | Stars | Subs | Plugins |\n' +
      '|---|-----------|-------------|-------|-------------|---------|\n' +
      '| 1 | [repo-1](https://github.com/owner/repo-1) |  | 9 | 5 | 0 |\n' +
      '| 2 | [repo-2](https://github.com/owner/repo-2) | A &#124; slash &#92;&#124; *bold* [link](url) | 4 | 0 | 0 |\n',
  )
  expect(repositories).toEqual(original)
})

it('uses the draft timestamp in UTC across midnight and rejects a mismatched catalog size', () => {
  const repositories = [repo(1, 1, 1)]
  expect(renderReadme(repositories, { id: 304, date: '2027-01-01T00:00:00.000Z', size: 1 })).toContain(
    '> Last updated: 01.01.2027 with 1 total repositories indexed.',
  )
  expect(() => renderReadme(repositories, { id: 304, date: '2027-01-01T00:00:00.000Z', size: 2 })).toThrow(/catalog size/i)
})

it.each(['not-a-date', '2026-09-23T21:00:00+03:00', '2026-02-30T00:00:00.000Z'])(
  'rejects invalid or non-UTC draft timestamps instead of rendering a misleading date: %s',
  (date) => {
    expect(() => renderReadme([repo(1, 1, 1)], { id: 304, date, size: 1 })).toThrow(/draft date.*ISO UTC/i)
  },
)

it('sorts stars, subscribers, then ascending original ID, taking at most 100 even for equal scores', () => {
  const repositories = Array.from({ length: 102 }, (_, index) => repo(102 - index, 10, 2))
  repositories.push(repo(104, 11, 0), repo(103, 10, 3))
  const markdown = renderReadme(repositories, { id: 304, date: '2026-09-23T00:00:00.000Z', size: 104 })
  const ids = [...markdown.matchAll(/^\| \d+ \| \[repo-(\d+)\]\(/gm)].map((match) => Number(match[1]))
  expect(ids).toHaveLength(100)
  expect(ids.slice(0, 5)).toEqual([104, 103, 1, 2, 3])
  expect(ids.at(-1)).toBe(98)
})

it('renders an empty catalog without ranked rows', () => {
  const markdown = renderReadme([], { id: 304, date: '2026-09-23T00:00:00.000Z', size: 0 })
  expect(markdown).toContain('with 0 total repositories indexed.')
  expect([...markdown.matchAll(/^\| \d+ \| /gm)]).toHaveLength(0)
})

const LEGACY_RANKED_LINKS = `
https://github.com/obra/superpowers
https://github.com/mattpocock/skills
https://github.com/affaan-m/ECC
https://github.com/multica-ai/andrej-karpathy-skills
https://github.com/anthropics/skills
https://github.com/f/prompts.chat
https://github.com/anthropics/claude-code
https://github.com/DietrichGebert/ponytail
https://github.com/vercel/next.js
https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
https://github.com/JuliusBrussee/caveman
https://github.com/addyosmani/agent-skills
https://github.com/nexu-io/open-design
https://github.com/ruvnet/RuView
https://github.com/thedotmack/claude-mem
https://github.com/storybookjs/storybook
https://github.com/Leonxlnx/taste-skill
https://github.com/Egonex-AI/Understand-Anything
https://github.com/headroomlabs-ai/headroom
https://github.com/ruvnet/ruflo
https://github.com/career-ops-hq/career-ops
https://github.com/pbakaus/impeccable
https://github.com/mem0ai/mem0
https://github.com/mvanhorn/last30days-skill
https://github.com/upstash/context7
https://github.com/tw93/Pake
https://github.com/MemPalace/mempalace
https://github.com/hugohe3/ppt-master
https://github.com/heygen-com/hyperframes
https://github.com/ChromeDevTools/chrome-devtools-mcp
https://github.com/blader/humanizer
https://github.com/coreyhaines31/marketingskills
https://github.com/ayghri/i-have-adhd
https://github.com/HKUDS/CLI-Anything
https://github.com/apple/container
https://github.com/Imbad0202/academic-research-skills
https://github.com/kepano/obsidian-skills
https://github.com/slidevjs/slidev
https://github.com/abhigyanpatwari/GitNexus
https://github.com/sickn33/agentic-awesome-skills
https://github.com/payloadcms/payload
https://github.com/ccxt/ccxt
https://github.com/vercel-labs/agent-browser
https://github.com/saadeghi/daisyui
https://github.com/cathrynlavery/diagram-design
https://github.com/alibaba/open-code-review
https://github.com/wshobson/agents
https://github.com/Yeachan-Heo/oh-my-claudecode
https://github.com/volcengine/OpenViking
https://github.com/CopilotKit/CopilotKit
https://github.com/anthropics/financial-services
https://github.com/anthropics/claude-plugins-official
https://github.com/huggingface/diffusers
https://github.com/openai/codex-plugin-cc
https://github.com/freestylefly/awesome-gpt-image-2
https://github.com/mukul975/Anthropic-Cybersecurity-Skills
https://github.com/feder-cr/invisible_playwright_mcp
https://github.com/garrytan/gbrain
https://github.com/tobi/qmd
https://github.com/zarazhangrui/frontend-slides
https://github.com/vectorize-io/hindsight
https://github.com/rohitg00/agentmemory
https://github.com/yamadashy/repomix
https://github.com/jarrodwatts/claude-hud
https://github.com/mlflow/mlflow
https://github.com/eyaltoledano/claude-task-master
https://github.com/gastownhall/beads
https://github.com/OthmanAdi/planning-with-files
https://github.com/phuryn/pm-skills
https://github.com/alirezarezvani/claude-skills
https://github.com/JimLiu/baoyu-skills
https://github.com/anthropics/knowledge-work-plugins
https://github.com/promptfoo/promptfoo
https://github.com/VoltAgent/awesome-claude-code-subagents
https://github.com/EveryInc/compound-engineering-plugin
https://github.com/clockworklabs/SpacetimeDB
https://github.com/pascalorg/editor
https://github.com/mksglu/context-mode
https://github.com/guillaumemeyer/watermarks-remover
https://github.com/snarktank/ralph
https://github.com/every-app/open-seo
https://github.com/google/skills
https://github.com/dailydotdev/daily
https://github.com/tanweai/pua
https://github.com/confident-ai/deepeval
https://github.com/browser-use/browser-harness
https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering
https://github.com/AgriciDaniel/claude-seo
https://github.com/bradautomates/claude-video
https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep
https://github.com/citrolabs/ego-lite
https://github.com/earthtojake/text-to-cad
https://github.com/ag-ui-protocol/ag-ui
https://github.com/pipecat-ai/pipecat
https://github.com/ifixai-ai/iFixAi
https://github.com/greensock/gsap-skills
https://github.com/AgriciDaniel/claude-obsidian
https://github.com/prowler-cloud/prowler
https://github.com/superset-sh/superset
https://github.com/qazbnm456/awesome-web-security
`
  .trim()
  .split('\n')

it('renders all 100 legacy repository links without changing their URLs', () => {
  const repositories = LEGACY_RANKED_LINKS.map((htmlUrl, index): PublishableRepository => {
    const url = new URL(htmlUrl)
    const [owner, repoName] = url.pathname.slice(1).split('/')
    if (!owner || !repoName) throw new Error(`Invalid legacy repository URL: ${htmlUrl}`)
    return {
      id: index + 1,
      html_url: htmlUrl,
      repo_name: repoName,
      owner,
      owner_url: `https://github.com/${owner}`,
      stargazers_count: LEGACY_RANKED_LINKS.length - index,
      subscribers_count: 0,
      forks_count: 0,
      plugins_count: null,
      description: null,
    }
  })

  const links = (text: string) =>
    [...text.matchAll(/^\| \d+ \| \[[^\]]+\]\((https:\/\/github\.com\/[^)]+)\) \|/gm)].map((match) => match[1])

  expect(links(renderReadme(repositories, { id: 304, date: '2026-09-22T08:12:33.125Z', size: repositories.length }))).toEqual(
    LEGACY_RANKED_LINKS,
  )
})
