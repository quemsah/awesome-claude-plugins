export type MarketplaceFixture = {
  name: string
  input: unknown
  valid: boolean
  pluginsCount: number
  marketplaceName?: string
}

export const marketplaceFixtures: readonly MarketplaceFixture[]
