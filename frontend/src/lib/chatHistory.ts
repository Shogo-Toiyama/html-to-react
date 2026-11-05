// The Step 5 conversation, saved in the project's `.launchpad/chat.json` (and
// localStorage), so it survives a reload and moves with the project folder.

import type { ChatProposal, ChatTurn } from './aiApi'
import { readTextFile, writeLocalFile } from './localFolder'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Code change proposed with this reply. */
  proposal?: ChatProposal
  model?: string
  /** What happened to the proposal. `historyId` is its entry in history.json once applied. */
  proposalState?: 'pending' | 'applied' | 'undone' | 'discarded'
  historyId?: string
  /** The reply failed; `text` holds what arrived before the error. */
  error?: string
}

const CHAT_FILE = '.launchpad/chat.json'

function storageKey(dir: FileSystemDirectoryHandle) {
  return `launchpad-chat:${dir.name}`
}

export async function readChat(dir: FileSystemDirectoryHandle): Promise<ChatMessage[]> {
  try {
    const text = await readTextFile(dir, CHAT_FILE)
    if (text) return (JSON.parse(text).messages ?? []) as ChatMessage[]
  } catch {
    // Fall back to the browser copy.
  }
  try {
    return JSON.parse(localStorage.getItem(storageKey(dir)) ?? '[]') as ChatMessage[]
  } catch {
    return []
  }
}

export async function saveChat(dir: FileSystemDirectoryHandle, messages: ChatMessage[]) {
  try {
    localStorage.setItem(storageKey(dir), JSON.stringify(messages))
  } catch {
    // Too big for localStorage: the folder copy is the main one.
  }
  await writeLocalFile(dir, CHAT_FILE, JSON.stringify({ version: 1, messages }, null, 2) + '\n')
}

/**
 * What the AI sees of earlier messages: the text, plus a line about each code
 * proposal and whether it was applied (the files themselves are sent fresh).
 */
export function toTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((message) => message.text.trim() || message.proposal)
    .map((message) => {
      if (message.role === 'user' || !message.proposal) return { role: message.role, text: message.text }
      const files = message.proposal.changes.map((change) => change.path).join(', ')
      const state =
        message.proposalState === 'applied'
          ? 'The student applied it.'
          : message.proposalState === 'undone'
            ? 'The student applied it, then undid it.'
            : 'The student did not apply it.'
      return {
        role: 'assistant',
        text: `${message.text}\n\n[Proposed change: ${message.proposal.summary} Files: ${files}. ${state}]`.trim(),
      }
    })
}
