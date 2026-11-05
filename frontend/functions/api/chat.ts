// POST /api/chat: the Step 5 assistant. Same settings as /api/suggest
// (ANTHROPIC_API_KEY, WORKSHOP_CODE, optional RATE_LIMIT_KV), with its own
// per-device limit. Replies with one JSON object per line (see ChatEvent):
// text as it is written, then an optional code proposal.

import {
  chatRequestSize,
  DEVICE_ID_HEADER,
  MAX_CHAT_MESSAGE,
  MAX_CHAT_TURNS,
  MAX_REQUEST_CHARS,
  WORKSHOP_CODE_HEADER,
  type ApiError,
  type ChatEvent,
  type ChatRequest,
} from '../../src/lib/aiApi'
import { chat } from '../../server/chat'
import { allowRequest } from '../../server/rateLimit'
import { emptyUsage, modelFor, SuggestError } from '../../server/suggest'

interface Env {
  ANTHROPIC_API_KEY?: string
  WORKSHOP_CODE?: string
  RATE_LIMIT_KV?: KVNamespace
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY || !env.WORKSHOP_CODE) {
    return fail(500, { code: 'not-configured', error: 'The AI isn’t set up on this server yet. Please tell the organizers.' })
  }
  if (request.headers.get(WORKSHOP_CODE_HEADER)?.trim().toLowerCase() !== env.WORKSHOP_CODE.trim().toLowerCase()) {
    return fail(401, { code: 'bad-code', error: 'That workshop code isn’t right.' })
  }
  const deviceId = request.headers.get(DEVICE_ID_HEADER) ?? ''
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(deviceId)) {
    return fail(400, { code: 'invalid-request', error: 'Missing device id.' })
  }

  let body: ChatRequest
  try {
    body = (await request.json()) as ChatRequest
  } catch {
    return fail(400, { code: 'invalid-request', error: 'The request could not be read.' })
  }
  if (!isChatRequest(body)) return fail(400, { code: 'invalid-request', error: 'The message could not be read.' })
  if (body.turns.at(-1)!.text.length > MAX_CHAT_MESSAGE) {
    return fail(400, { code: 'invalid-request', error: `Messages can be up to ${MAX_CHAT_MESSAGE} characters.` })
  }
  body.turns = body.turns.slice(-MAX_CHAT_TURNS)
  const size = chatRequestSize(body)
  if (size > MAX_REQUEST_CHARS) {
    return fail(413, { code: 'too-large', error: 'This project is too large to send.', size, limit: MAX_REQUEST_CHARS })
  }
  if (!(await allowRequest(env.RATE_LIMIT_KV, deviceId, 'chat'))) {
    return fail(429, { code: 'rate-limited', error: 'Too many messages from this computer. Please wait a few minutes.' })
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const emit = (event: ChatEvent) => void writer.write(encoder.encode(JSON.stringify(event) + '\n'))

  const model = modelFor('chat', env)
  const startedAt = Date.now()
  const usage = emptyUsage()
  let outcome = 'ok'
  const work = (async () => {
    try {
      const proposal = await chat(env.ANTHROPIC_API_KEY!, body, emit, usage, model)
      if (proposal) {
        outcome = 'proposal'
        emit({ type: 'proposal', proposal, model })
      }
      emit({ type: 'done' })
    } catch (error) {
      outcome = error instanceof SuggestError ? 'rejected' : 'error'
      const message =
        error instanceof SuggestError ? error.message : 'AI couldn’t finish this time. Please try again in a moment.'
      if (!(error instanceof SuggestError)) console.error('chat failed', error)
      emit({ type: 'error', code: 'ai-failed', error: message })
    } finally {
      // One line per call, for cost tracking (same shape as /api/suggest, step "chat").
      console.log(
        JSON.stringify({
          event: 'suggest',
          outcome,
          step: 'chat',
          device: deviceId.slice(0, 8),
          requestChars: size,
          turns: body.turns.length,
          seconds: Math.round((Date.now() - startedAt) / 1000),
          ...usage,
          costUsd: Math.round(usage.costUsd * 10000) / 10000,
        }),
      )
      await writer.close()
    }
  })()
  void work

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function fail(status: number, body: ApiError): Response {
  return Response.json(body, { status })
}

function isChatRequest(value: unknown): value is ChatRequest {
  const v = value as ChatRequest
  const isTurns =
    Array.isArray(v?.turns) &&
    v.turns.length > 0 &&
    v.turns.every((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string') &&
    v.turns.at(-1)!.role === 'user'
  const isFiles =
    Array.isArray(v?.files) && v.files.every((f) => typeof f?.path === 'string' && typeof f?.content === 'string')
  return isTurns && isFiles && (v.page === undefined || typeof v.page === 'string')
}
