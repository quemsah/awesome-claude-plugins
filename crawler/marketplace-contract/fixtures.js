export const marketplaceFixtures = [
  {
    name: 'top-level plugins wrapper',
    input: {
      name: 'official-market',
      plugins: [
        { name: 'alpha', source: './plugins/alpha', author: 'Acme' },
        { id: 'beta', description: 'Beta plugin', mcpServers: { beta: { command: 'npx' } } },
      ],
    },
    valid: true,
    pluginsCount: 2,
    marketplaceName: 'official-market',
  },
  {
    name: 'nested marketplace wrapper',
    input: { marketplace: { name: 'nested-market', plugins: [{ name: 'nested', source: './plugins/nested' }] } },
    valid: true,
    pluginsCount: 1,
    marketplaceName: 'nested-market',
  },
  {
    name: 'repositories wrapper',
    input: { repositories: [{ name: 'repository-plugin', source: './plugins/repository-plugin' }] },
    valid: true,
    pluginsCount: 1,
  },
  {
    name: 'plugin array',
    input: [{ name: 'array-plugin', source: './plugins/array-plugin' }],
    valid: true,
    pluginsCount: 1,
  },
  {
    name: 'single plugin',
    input: { name: 'single-plugin', source: './plugins/single-plugin' },
    valid: true,
    pluginsCount: 1,
  },
  {
    name: 'skill-only marketplace metadata',
    input: { skills: { pgns: { name: 'pgns' } }, strict: false },
    valid: true,
    pluginsCount: 0,
  },
  {
    name: 'empty plugins wrapper',
    input: { plugins: [] },
    valid: true,
    pluginsCount: 0,
  },
  {
    name: 'empty plugin entry',
    input: { plugins: [{}] },
    valid: false,
    pluginsCount: 0,
  },
  {
    name: 'unsafe source URL',
    input: { plugins: [{ name: 'unsafe', source: { source: 'url', url: 'https://user:pass@example.com/plugin.git' } }] },
    valid: false,
    pluginsCount: 0,
  },
]
