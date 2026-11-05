// The contract between Launchpad and its backend (functions/api/*), shared by
// both sides. Types and constants only: no browser or Worker APIs here.

/**
 * What the AI is asked to do:
 * - `components`: split pages into components (Step 2)
 * - `props`: merge repeated parts into one component with props (Step 3)
 * - `tailwind`: replace CSS with Tailwind classes in one component or the whole site (Step 4)
 * - `tailwind-cleanup`: delete CSS rules nothing uses anymore (Step 4, after the whole site)
 */
export type AiStep = 'components' | 'props' | 'tailwind' | 'tailwind-cleanup'

export const AI_STEPS: AiStep[] = ['components', 'props', 'tailwind', 'tailwind-cleanup']

/** `target` value meaning "the whole site". */
export const WHOLE_SITE = '*'

export interface ProjectFile {
  path: string
  content: string
}

export interface SuggestRequest {
  step: AiStep
  /** For `tailwind`: the one file to convert, or WHOLE_SITE. */
  target?: string
  /** Files the AI may change (pages, existing components). */
  editable: ProjectFile[]
  /** Files shown for context only (legacy scripts, App.jsx, CSS class names...). */
  context: ProjectFile[]
}

export interface SuggestedComponent {
  name: string
  /** Where it is defined, e.g. `src/components/Header.jsx`. */
  file: string
  /** One sentence for participants: what part of the page it is. */
  description: string
  /** Props it takes (Step 3), e.g. `title`, `description`. */
  props: string[]
}

export interface FileChange {
  path: string
  action: 'created' | 'modified'
  /** What changed in this file and why, for the change log. */
  description: string
}

export interface Suggestion {
  /** Two or three sentences for participants. */
  summary: string
  components: SuggestedComponent[]
  changes: FileChange[]
  /** New contents of every created or modified file. */
  files: ProjectFile[]
}

export interface SuggestResponse {
  suggestion: Suggestion
  model: string
}

export interface ApiError {
  error: string
  /** For `too-large`: the request size and the limit, in characters. */
  size?: number
  limit?: number
  code?: 'bad-code' | 'too-large' | 'rate-limited' | 'invalid-request' | 'ai-failed' | 'not-configured'
}

/**
 * Most code the AI may read in one request (characters). Workshop pages are a
 * few KB; this only stops accidents (e.g. a huge generated file). Launchpad
 * warns before sending instead of cutting anything off.
 */
export const MAX_REQUEST_CHARS = 150_000

export const WORKSHOP_CODE_HEADER = 'X-Workshop-Code'
export const DEVICE_ID_HEADER = 'X-Device-Id'

export function requestSize(request: SuggestRequest): number {
  return [...request.editable, ...request.context].reduce((sum, file) => sum + file.content.length, 0)
}

// ---- Step 5: chat (POST /api/chat) ----

/** Steps recorded in the change log: the AI steps above, plus changes proposed in the chat. */
export type HistoryStep = AiStep | 'chat'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatRequest {
  /** The conversation so far, oldest first; the last turn is the participant's new message. */
  turns: ChatTurn[]
  /** The project's current code (src/, package.json). The AI may change files in src/. */
  files: ProjectFile[]
  /** The page open in the preview, e.g. `/about`. */
  page?: string
}

/** A code change proposed in the chat. Applied, undone and logged like a Suggestion. */
export interface ChatProposal extends Suggestion {
  /**
   * How to show a new or changed component on its own, e.g.
   * `{ component: 'LikeButton', jsx: '<LikeButton label="Like" />' }`. Not shown yet (planned).
   */
  preview?: { component: string; jsx: string } | null
}

/** Events streamed by /api/chat, one JSON object per line. */
export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'status'; message: string }
  | { type: 'progress'; chars: number }
  | { type: 'proposal'; proposal: ChatProposal; model: string }
  | { type: 'done' }
  | { type: 'error'; error: string; code: 'ai-failed' }

/** Longest message a participant can type (characters). */
export const MAX_CHAT_MESSAGE = 2000
/** Room for what's attached to a message (a picked component, an error), on top of MAX_CHAT_MESSAGE. */
export const MAX_CHAT_ATTACHMENTS = 5000
/** Most turns sent with each message; older ones are left out. */
export const MAX_CHAT_TURNS = 16

export function chatRequestSize(request: ChatRequest): number {
  return request.files.reduce((sum, file) => sum + file.content.length, 0)
}
