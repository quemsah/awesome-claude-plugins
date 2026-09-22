export type StatusPriority = 'polite' | 'assertive'

export type StatusMessage = {
  readonly text: string
  /**
   * Flipped on every announcement so repeating the same message is still a text change. Screen readers
   * announce a live region when its content changes, and copying the same command twice produces the
   * same sentence.
   */
  readonly parity: boolean
}

const EMPTY_MESSAGE: StatusMessage = { parity: false, text: '' }

/** A zero-width space: invisible, read out as nothing, and enough to make repeated text a change. */
const REPEAT_MARKER = '\u200B'
const CLEAR_AFTER_MS = 5_000

const messages: Record<StatusPriority, StatusMessage> = { polite: EMPTY_MESSAGE, assertive: EMPTY_MESSAGE }
const listeners = new Set<() => void>()
const clearTimers: Partial<Record<StatusPriority, ReturnType<typeof setTimeout>>> = {}

function notifyListeners(): void {
  for (const listener of listeners) listener()
}

export function getStatusMessage(priority: StatusPriority): StatusMessage {
  return messages[priority]
}

/** The exact text to place in the live region, including the invisible repeat marker. */
export function getStatusAnnouncement(message: StatusMessage): string {
  if (!message.text) return ''
  return message.parity ? `${message.text}${REPEAT_MARKER}` : message.text
}

export function announceStatus(text: string, priority: StatusPriority = 'polite'): void {
  const previousTimer = clearTimers[priority]
  if (previousTimer !== undefined) clearTimeout(previousTimer)

  const message = { parity: !messages[priority].parity, text }
  messages[priority] = message
  notifyListeners()

  if (!text) {
    delete clearTimers[priority]
    return
  }

  clearTimers[priority] = setTimeout(() => {
    if (messages[priority] !== message) return
    messages[priority] = { parity: message.parity, text: '' }
    delete clearTimers[priority]
    notifyListeners()
  }, CLEAR_AFTER_MS)
}

export function subscribeToStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
