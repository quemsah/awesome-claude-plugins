export type LcpElementType = 'image' | 'text' | 'other'

/** Classify only the element type, never its content, id, class or URL. */
export function classifyLcpElement(entries: readonly unknown[] | undefined): LcpElementType | null {
  const entry = entries?.at(-1)
  if (!entry || typeof entry !== 'object' || !('element' in entry)) return null
  const element = entry.element
  if (!element || typeof element !== 'object' || !('tagName' in element) || typeof element.tagName !== 'string') return null

  const tag = element.tagName.toUpperCase()
  if (['IMG', 'PICTURE', 'VIDEO', 'SVG'].includes(tag)) return 'image'
  if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'DIV', 'SPAN', 'SECTION', 'MAIN', 'ARTICLE'].includes(tag)) return 'text'
  return 'other'
}
