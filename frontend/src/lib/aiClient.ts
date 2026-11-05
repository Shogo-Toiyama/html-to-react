// Talks to the backend (functions/api/suggest.ts and chat.ts): gathers the
// project's files, sends them, and streams progress back.

import {
  DEVICE_ID_HEADER,
  WORKSHOP_CODE_HEADER,
  type AiStep,
  type ApiError,
  type ChatEvent,
  type ChatProposal,
  type ChatRequest,
  type ProjectFile,
  type SuggestRequest,
  type Suggestion,
  WHOLE_SITE,
} from './aiApi'
import { readBytes, scanFolder } from './localFolder'

const CODE_KEY = 'launchpad-workshop-code'
const DEVICE_KEY = 'launchpad-device-id'

export function savedWorkshopCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveWorkshopCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code)
    else localStorage.removeItem(CODE_KEY)
  } catch {
    // Asked again next time.
  }
}

/** A random id for this browser, so request limits are per computer (the whole room shares one IP). */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

/**
 * The files the AI may change for this step, plus read-only context:
 * - components / props: pages and components; legacy scripts and routes as context
 * - tailwind: one JSX file (`target`) or all of them; CSS and legacy scripts as context
 * - tailwind-cleanup: the CSS files; all JSX and legacy scripts as context
 */
export async function collectRequest(dir: FileSystemDirectoryHandle, step: AiStep, target?: string): Promise<SuggestRequest> {
  const snapshot = await scanFolder(dir)
  const decoder = new TextDecoder()
  const paths = [...snapshot.keys()].filter((path) => path.startsWith('src/')).sort()
  const multiPage = paths.some((path) => /^src\/pages\/[^/]+\.jsx$/.test(path))
  const isComponentFile = (path: string) =>
    /^src\/components\/.+\.jsx$/.test(path) || (multiPage ? /^src\/pages\/[^/]+\.jsx$/.test(path) : path === 'src/App.jsx')
  const isLegacy = (path: string) => /legacy-script\.js$/.test(path)
  const isCss = (path: string) => path.endsWith('.css')

  let isEditable: (path: string) => boolean
  let isContext: (path: string) => boolean
  if (step === 'tailwind') {
    isEditable = (path) => isComponentFile(path) && (!target || target === WHOLE_SITE || path === target)
    isContext = (path) => isCss(path) || isLegacy(path)
  } else if (step === 'tailwind-cleanup') {
    isEditable = isCss
    isContext = (path) => isComponentFile(path) || isLegacy(path)
  } else {
    isEditable = isComponentFile
    isContext = (path) => isLegacy(path) || (multiPage && path === 'src/App.jsx')
  }

  const read = async (path: string): Promise<ProjectFile> => ({
    path,
    content: decoder.decode(await readBytes(snapshot.get(path)!)),
  })
  return {
    step,
    target,
    editable: await Promise.all(paths.filter(isEditable).map(read)),
    context: await Promise.all(paths.filter((path) => !isEditable(path) && isContext(path)).map(read)),
  }
}

/** JSX files a participant can pick for "convert one component" (Step 4). */
export async function listComponentFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const paths = [...(await scanFolder(dir)).keys()].filter((path) => path.startsWith('src/')).sort()
  const multiPage = paths.some((path) => /^src\/pages\/[^/]+\.jsx$/.test(path))
  return paths.filter(
    (path) => /^src\/components\/.+\.jsx$/.test(path) || (multiPage ? /^src\/pages\/[^/]+\.jsx$/.test(path) : path === 'src/App.jsx'),
  )
}

export type SuggestProgress = { type: 'status'; message: string } | { type: 'progress'; chars: number }

export class AiRequestError extends Error {
  readonly info: ApiError
  constructor(info: ApiError) {
    super(info.error)
    this.info = info
  }
}

export async function requestSuggestion(
  request: SuggestRequest,
  workshopCode: string,
  onProgress: (progress: SuggestProgress) => void,
): Promise<{ suggestion: Suggestion; model: string }> {
  let result: { suggestion: Suggestion; model: string } | null = null
  type SuggestEvent =
    | SuggestProgress
    | { type: 'result'; suggestion: Suggestion; model: string }
    | { type: 'error'; code: ApiError['code']; error: string }
  await postStream<SuggestEvent>('/api/suggest', request, workshopCode, (event) => {
    if (event.type === 'result') result = { suggestion: event.suggestion, model: event.model }
    else if (event.type === 'error') throw new AiRequestError({ code: event.code, error: event.error })
    else onProgress(event)
  })
  if (!result) throw closedEarly()
  return result
}

/**
 * The project's code for the chat: everything in src/ that's text, plus
 * package.json (so the AI knows which packages are installed).
 */
export async function collectChatFiles(dir: FileSystemDirectoryHandle): Promise<ProjectFile[]> {
  const snapshot = await scanFolder(dir)
  const decoder = new TextDecoder()
  const paths = [...snapshot.keys()]
    .filter((path) => path === 'package.json' || (path.startsWith('src/') && /\.(jsx|js|css|json)$/.test(path)))
    .sort()
  return Promise.all(paths.map(async (path) => ({ path, content: decoder.decode(await readBytes(snapshot.get(path)!)) })))
}

export interface ChatHandlers {
  onText(delta: string): void
  onStatus(message: string): void
  onProgress(chars: number): void
}

/** Sends a chat message; streams the reply to `handlers` and resolves with the proposal, if any. */
export async function requestChat(
  request: ChatRequest,
  workshopCode: string,
  handlers: ChatHandlers,
): Promise<{ proposal: ChatProposal; model: string } | null> {
  let proposal: { proposal: ChatProposal; model: string } | null = null
  let done = false
  await postStream<ChatEvent>('/api/chat', request, workshopCode, (event) => {
    if (event.type === 'text') handlers.onText(event.delta)
    else if (event.type === 'status') handlers.onStatus(event.message)
    else if (event.type === 'progress') handlers.onProgress(event.chars)
    else if (event.type === 'proposal') proposal = { proposal: event.proposal, model: event.model }
    else if (event.type === 'done') done = true
    else if (event.type === 'error') throw new AiRequestError({ code: event.code, error: event.error })
  })
  if (!done) throw closedEarly()
  return proposal
}

function closedEarly() {
  return new AiRequestError({ code: 'ai-failed', error: 'The connection closed before AI finished. Please try again.' })
}

/** POSTs `body` and calls `onEvent` for each line of the NDJSON reply until the stream ends. */
async function postStream<E>(url: string, body: unknown, workshopCode: string, onEvent: (event: E) => void) {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WORKSHOP_CODE_HEADER]: workshopCode,
        [DEVICE_ID_HEADER]: deviceId(),
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AiRequestError({ code: 'ai-failed', error: 'Couldn’t reach the server. Check your internet connection.' })
  }
  if (!response.ok) {
    const info = (await response.json().catch(() => null)) as ApiError | null
    if (response.status === 404 || response.status === 405) {
      throw new AiRequestError({ code: 'not-configured', error: 'The AI server isn’t running here (no /api).' })
    }
    throw new AiRequestError(info ?? { code: 'ai-failed', error: `Server error (${response.status}).` })
  }

  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onEvent(JSON.parse(line) as E)
    }
    if (done) return
  }
}
