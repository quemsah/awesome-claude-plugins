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

const messages: Record<StatusPriority, StatusMessage> = { polite: EMPTY_MESSAGE, assertive: EMPTY_MESSAGE }
const listeners = new Set<() => void>()

export function getStatusMessage(priority: StatusPriority): StatusMessage {
  return messages[priority]
}

/** The exact text to place in the live region, including the invisible repeat marker. */
export function getStatusAnnouncement(message: StatusMessage): string {
  if (!message.text) return ''
  return message.parity ? `${message.text}${REPEAT_MARKER}` : message.text
}

export function announceStatus(text: string, priority: StatusPriority = 'polite'): void {
  messages[priority] = { parity: !messages[priority].parity, text }
  for (const listener of listeners) listener()
}

export function subscribeToStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
