const SCROLL_POSITIONS_KEY = 'catalog-scroll-positions'
const MAX_TRACKED_POSITIONS = 10

type ScrollPositions = Record<string, number>

/** Only `sessionStorage` accessors are needed, which keeps the helpers testable without a DOM. */
export type ScrollStore = Pick<Storage, 'getItem' | 'setItem'>

/**
 * The catalog list owns the `/` route, so anything else is a detail or static page whose scroll
 * offset must not be mistaken for a list offset.
 */
export function isCatalogListPath(pathname: string): boolean {
  return pathname === '/'
}

export function catalogScrollKey(pathname: string, search: string): string {
  return `${pathname}${search}`
}

function readPositions(store: ScrollStore): ScrollPositions {
  const raw = store.getItem(SCROLL_POSITIONS_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 0)
    )
  } catch {
    return {}
  }
}

function writePositions(store: ScrollStore, positions: ScrollPositions): void {
  const entries = Object.entries(positions).slice(-MAX_TRACKED_POSITIONS)
  store.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(Object.fromEntries(entries)))
}

export function saveScrollPosition(store: ScrollStore, url: string, scrollY: number): void {
  const positions = readPositions(store)
  const rounded = Math.round(scrollY)
  if (positions[url] === rounded) {
    return
  }
  // Re-inserting keeps newest-last order, so trimming drops the least recently written offset.
  delete positions[url]
  positions[url] = rounded
  writePositions(store, positions)
}

export function readScrollPosition(store: ScrollStore, url: string): number {
  return readPositions(store)[url] ?? 0
}

export function clearScrollPosition(store: ScrollStore, url: string): void {
  const positions = readPositions(store)
  delete positions[url]
  writePositions(store, positions)
}
