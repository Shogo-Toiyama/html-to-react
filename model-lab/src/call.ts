// One suggest call with a chosen model. Same prompt, schema, validation and
// one fix-up round as frontend/server/suggest.ts, but the model is a parameter and
// the safety fallback is off so a result always comes from the model being tested.

import Anthropic from '@anthropic-ai/sdk'
import type { SuggestRequest, Suggestion } from '../../frontend/src/lib/aiApi'
import { SUGGESTION_SCHEMA, systemPrompt, userPrompt } from '../../frontend/server/prompts'
import { addUsage, emptyUsage, type SuggestUsage } from '../../frontend/server/suggest'
import { validateSuggestion } from '../../frontend/server/validate'

export interface CallResult {
  model: string
  suggestion: Suggestion | null
  /** Validator problems left in the final answer (empty = passed). */
  errors: string[]
  /** Problems the first answer had (empty = passed on the first try). */
  firstErrors: string[]
  failure?: string
  usage: SuggestUsage
  seconds: number
}

export async function callModel(model: string, request: SuggestRequest, effort = 'medium'): Promise<CallResult> {
  const client = new Anthropic() // reads ANTHROPIC_API_KEY
  const usage = emptyUsage()
  const started = Date.now()
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userPrompt(request) }]
  let firstErrors: string[] = []
  const done = (suggestion: Suggestion | null, errors: string[], failure?: string): CallResult => ({
    model, suggestion, errors, firstErrors, failure, usage, seconds: (Date.now() - started) / 1000,
  })

  for (let attempt = 1; attempt <= 2; attempt++) {
    let message: Anthropic.Beta.BetaMessage
    try {
      message = await client.beta.messages
        .stream({
          model,
          max_tokens: 64000,
          output_config: { effort, format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } } as never,
          system: systemPrompt(request.step),
          messages,
        })
        .finalMessage()
    } catch (error) {
      return done(null, [], `API error: ${String(error)}`)
    }
    addUsage(usage, message)
    if (message.stop_reason === 'refusal') return done(null, [], 'refused')
    if (message.stop_reason === 'max_tokens') return done(null, [], 'max_tokens')
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
    let suggestion: Suggestion
    try {
      suggestion = JSON.parse(text) as Suggestion
    } catch {
      return done(null, [], 'unreadable JSON')
    }
    const errors = validateSuggestion(request, suggestion)
    if (attempt === 1) firstErrors = errors
    if (errors.length === 0 || attempt === 2) return done(suggestion, errors)
    messages.push({ role: 'assistant', content: message.content })
    messages.push({ role: 'user', content: `Your answer has these problems. Return the whole corrected answer.\n- ${errors.join('\n- ')}` })
  }
  return done(null, [], 'no answer')
}
