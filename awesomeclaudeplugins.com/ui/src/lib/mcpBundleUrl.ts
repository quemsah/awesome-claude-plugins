/** Only link directly to valid HTTPS MCP bundle URLs, never arbitrary manifest strings. */
export function getMcpBundleUrl(value: string): string | null {
  if (!value.startsWith('https://')) return null

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/\.(?:mcpb|dxt)$/i.test(url.pathname)
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}
