// Hands things to the Step 5 chat from elsewhere in Launchpad (e.g. "Ask AI to
// fix" on a preview error). The chat may not be on screen yet: App switches to
// the chat step, and ChatPanel takes the waiting item when it mounts.

export interface ChatError {
  kind: 'build' | 'runtime'
  message: string
  /** The page the preview was showing. */
  page: string | null
}

const EVENT = 'launchpad:chat-inbox'
let waiting: ChatError | null = null

export function sendErrorToChat(error: ChatError) {
  waiting = error
  window.dispatchEvent(new Event(EVENT))
}

/** The waiting item, removed from the inbox. */
export function takeChatInbox(): ChatError | null {
  const item = waiting
  waiting = null
  return item
}

export function onChatInbox(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
