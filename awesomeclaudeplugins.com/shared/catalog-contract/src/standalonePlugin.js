/** Catalog identity validation; this does not execute or validate plugin components. */
export class StandalonePluginFormatError extends Error {
  constructor() {
    super('Plugin manifest must have a non-empty name of at most 160 characters without control characters')
    this.name = 'StandalonePluginFormatError'
  }
}

export function parseStandalonePlugin(value) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value.name) || !value.name.isWellFormed()
  ) throw new StandalonePluginFormatError()
  return { ...value }
}

export function toStandaloneCatalogManifest(manifest) {
  return { manifestKind: 'standalone-plugin', plugins: [{ ...manifest, source: './' }] }
}
