export function getMarkdownResponseHeaders(cacheControl: string): Headers {
  return new Headers({
    'Cache-Control': cacheControl,
    'Content-Type': 'text/markdown; charset=utf-8',
    'X-Robots-Tag': 'noindex',
  })
}
