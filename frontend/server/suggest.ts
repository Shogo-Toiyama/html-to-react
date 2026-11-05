// Asks Claude for a component split (or props refactor), checks the answer,
// and gives the model one chance to fix problems.

import Anthropic from '@anthropic-ai/sdk'
import type { SuggestRequest, Suggestion } from '../src/lib/aiApi'
import { SUGGESTION_SCHEMA, systemPrompt, userPrompt } from './prompts'
import { validateSuggestion } from './validate'

/** Code changes: Claude Sonnet 5.5. (Claude Haiku 5.5 is for light text-only tasks.) */
export const CODE_MODEL = 'claude-sonnet-5-5'

/** Progress events streamed to the browser while Claude works (one JSON object per line). */
export type SuggestEvent =
  | { type: 'status'; message: string }
  | { type: 'progress'; chars: number }
  | { type: 'result'; suggestion: Suggestion; model: string }
  | { type: 'error'; error: string; code: 'ai-failed' }

export class SuggestError extends Error {}

/** Tokens and cost of one /api/suggest or /api/chat call, summed over its attempts (for the logs). */
export interface SuggestUsage {
  attempts: number
  /** Models that answered (a fallback model may appear after a decline). */
  models: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

/** USD per million tokens [input, output]. Cache reads cost 0.1x input, cache writes 1.25x. */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}

export function emptyUsage(): SuggestUsage {
  return { attempts: 0, models: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }
}

export function addUsage(total: SuggestUsage, message: Anthropic.Beta.BetaMessage) {
  const u = message.usage
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  const [inPrice, outPrice] = PRICES[message.model] ?? PRICES[CODE_MODEL]
  total.attempts += 1
  if (!total.models.includes(message.model)) total.models.push(message.model)
  total.inputTokens += u.input_tokens
  total.outputTokens += u.output_tokens
  total.cacheReadTokens += cacheRead
  total.cacheWriteTokens += cacheWrite
  total.costUsd +=
    (u.input_tokens * inPrice + cacheRead * inPrice * 0.1 + cacheWrite * inPrice * 1.25 + u.output_tokens * outPrice) /
    1_000_000
}

/** `usage` is filled in as attempts finish, so it is complete even when this throws. */
export async function suggest(
  apiKey: string,
  request: SuggestRequest,
  emit: (event: SuggestEvent) => void,
  usage: SuggestUsage,
): Promise<Suggestion> {
  const client = new Anthropic({ apiKey })
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userPrompt(request) }]

  for (let attempt = 1; attempt <= 2; attempt++) {
    emit({ type: 'status', message: attempt === 1 ? 'Claude is reading your page…' : 'Fixing a few problems…' })
    let chars = 0
    let lastReport = 0
    const stream = client.beta.messages.stream({
      model: CODE_MODEL,
      max_tokens: 64000,
      // Re-runs the request on another model if a safety classifier declines it.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
      system: systemPrompt(request.step),
      messages,
    })
    stream.on('text', (delta) => {
      chars += delta.length
      if (Date.now() - lastReport > 800) {
        lastReport = Date.now()
        emit({ type: 'progress', chars })
      }
    })
    const message = await stream.finalMessage()
    addUsage(usage, message)

    if (message.stop_reason === 'refusal') throw new SuggestError('Claude declined this request.')
    if (message.stop_reason === 'max_tokens') throw new SuggestError('The answer was too long. Try a smaller page.')
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
    let suggestion: Suggestion
    try {
      suggestion = JSON.parse(text) as Suggestion
    } catch {
      throw new SuggestError('Claude returned an answer that could not be read.')
    }

    const errors = validateSuggestion(request, suggestion)
    if (errors.length === 0) return suggestion
    if (attempt === 2) throw new SuggestError(`The suggestion still had problems: ${errors.slice(0, 3).join(' ')}`)
    // Append-only: keep Claude's answer (with its thinking blocks) and ask for a fix.
    messages.push({ role: 'assistant', content: message.content })
    messages.push({
      role: 'user',
      content: `Your answer has these problems. Return the whole corrected answer.\n- ${errors.join('\n- ')}`,
    })
  }
  throw new SuggestError('No suggestion.')
}
