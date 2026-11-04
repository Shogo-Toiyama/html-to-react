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

export async function suggest(
  apiKey: string,
  request: SuggestRequest,
  emit: (event: SuggestEvent) => void,
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
