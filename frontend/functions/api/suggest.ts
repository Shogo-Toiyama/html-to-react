// POST /api/suggest: split a page into components (Step 2) or merge repeated
// parts into components with props (Step 3).
//
// Settings (Cloudflare Pages → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY  secret
//   WORKSHOP_CODE      e.g. "buildwithai"; participants type it once
//   RATE_LIMIT_KV      optional KV binding for per-device limits
//
// Replies with one JSON object per line (see SuggestEvent), so the browser can
// show progress while Claude works and the connection never sits idle.

import {
  AI_STEPS,
  DEVICE_ID_HEADER,
  MAX_REQUEST_CHARS,
  requestSize,
  WORKSHOP_CODE_HEADER,
  type ApiError,
  type SuggestRequest,
} from '../../src/lib/aiApi'
import { allowRequest } from '../../server/rateLimit'
import { emptyUsage, modelFor, suggest, SuggestError, type SuggestEvent } from '../../server/suggest'

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

  let body: SuggestRequest
  try {
    body = (await request.json()) as SuggestRequest
  } catch {
    return fail(400, { code: 'invalid-request', error: 'The request could not be read.' })
  }
  if (!isSuggestRequest(body)) return fail(400, { code: 'invalid-request', error: 'The request is missing files.' })
  // Launchpad warns before sending; this only catches requests that skipped that check.
  const size = requestSize(body)
  if (size > MAX_REQUEST_CHARS) {
    return fail(413, { code: 'too-large', error: 'This project is too large to send.', size, limit: MAX_REQUEST_CHARS })
  }
  if (!(await allowRequest(env.RATE_LIMIT_KV, deviceId))) {
    return fail(429, { code: 'rate-limited', error: 'Too many requests from this computer. Please wait a few minutes.' })
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const emit = (event: SuggestEvent) => void writer.write(encoder.encode(JSON.stringify(event) + '\n'))

  const model = modelFor(body.step, env)
  const startedAt = Date.now()
  const usage = emptyUsage()
  let outcome = 'ok'
  const work = (async () => {
    try {
      const suggestion = await suggest(env.ANTHROPIC_API_KEY!, body, emit, usage, model)
      emit({ type: 'result', suggestion, model })
    } catch (error) {
      outcome = error instanceof SuggestError ? 'rejected' : 'error'
      const message =
        error instanceof SuggestError ? error.message : 'Claude couldn’t finish this time. Please try again in a moment.'
      if (!(error instanceof SuggestError)) console.error('suggest failed', error)
      emit({ type: 'error', code: 'ai-failed', error: message })
    } finally {
      // One line per call, for cost tracking: Cloudflare dashboard → Logs, or `wrangler pages deployment tail`.
      console.log(
        JSON.stringify({
          event: 'suggest',
          outcome,
          step: body.step,
          device: deviceId.slice(0, 8),
          requestChars: size,
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

function isSuggestRequest(value: unknown): value is SuggestRequest {
  const v = value as SuggestRequest
  const isFiles = (files: unknown) =>
    Array.isArray(files) && files.every((f) => typeof f?.path === 'string' && typeof f?.content === 'string')
  return AI_STEPS.includes(v?.step) && isFiles(v.editable) && isFiles(v.context) && v.editable.length > 0
}
