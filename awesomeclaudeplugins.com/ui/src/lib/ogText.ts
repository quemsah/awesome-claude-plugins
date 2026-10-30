/**
 * Satori's default OG font can fetch unsupported pictographic glyphs dynamically.
 * Remove decorative symbols only in image previews; preserve ordinary language text.
 */
export function sanitizeOgDescription(value: string): string {
  return value
    .replaceAll(/[\p{So}\p{Sk}]/gu, ' ')
    .replaceAll(/\uFE0e|\uFE0f|\u200d/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}
