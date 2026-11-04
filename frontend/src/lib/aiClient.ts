// Talks to the backend (functions/api/suggest.ts): gathers the project's files,
// sends them, and streams progress back.

import {
  DEVICE_ID_HEADER,
  WORKSHOP_CODE_HEADER,
  type AiStep,
  type ApiError,
  type ProjectFile,
  type SuggestRequest,
  type Suggestion,
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

/** The page files the AI may change, plus read-only context (legacy scripts, routes). */
export async function collectRequest(dir: FileSystemDirectoryHandle, step: AiStep): Promise<SuggestRequest> {
  const snapshot = await scanFolder(dir)
  const decoder = new TextDecoder()
  const paths = [...snapshot.keys()].filter((path) => path.startsWith('src/')).sort()
  const multiPage = paths.some((path) => /^src\/pages\/[^/]+\.jsx$/.test(path))
  const isEditable = (path: string) =>
    /^src\/components\/.+\.jsx$/.test(path) || (multiPage ? /^src\/pages\/[^/]+\.jsx$/.test(path) : path === 'src/App.jsx')
  const isContext = (path: string) =>
    /legacy-script\.js$/.test(path) || (multiPage && path === 'src/App.jsx')

  const read = async (path: string): Promise<ProjectFile> => ({
    path,
    content: decoder.decode(await readBytes(snapshot.get(path)!)),
  })
  return {
    step,
    editable: await Promise.all(paths.filter(isEditable).map(read)),
    context: await Promise.all(paths.filter(isContext).map(read)),
  }
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
  let response: Response
  try {
    response = await fetch('/api/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WORKSHOP_CODE_HEADER]: workshopCode,
        [DEVICE_ID_HEADER]: deviceId(),
      },
      body: JSON.stringify(request),
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

  // One JSON event per line.
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === 'result') return { suggestion: event.suggestion, model: event.model }
      if (event.type === 'error') throw new AiRequestError({ code: event.code, error: event.error })
      onProgress(event)
    }
    if (done) break
  }
  throw new AiRequestError({ code: 'ai-failed', error: 'The connection closed before Claude finished. Please try again.' })
}
