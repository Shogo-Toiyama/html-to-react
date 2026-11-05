// Step 5 chat: Claude answers in text (streamed to the browser as it is
// written) and, when code should change, calls propose_changes with the files.
// The proposal is checked like the step suggestions, with one chance to fix it.

import Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent, ChatProposal, ChatRequest, ChatTurn } from '../src/lib/aiApi'
import { CHAT_SYSTEM, filesBlock, PROPOSE_TOOL } from './chatPrompts'
import { addUsage, SuggestError, type SuggestUsage } from './suggest'
import { validateChatProposal } from './validate'

const CACHE = { type: 'ephemeral' } as const

/** Turns must alternate and start with the participant. */
function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const turn of turns) {
    if (!turn.text.trim()) continue
    if (out.length === 0 && turn.role !== 'user') continue
    const last = out.at(-1)
    if (last?.role === turn.role) last.text += '\n\n' + turn.text
    else out.push({ ...turn })
  }
  return out
}

function buildMessages(request: ChatRequest): Anthropic.Beta.BetaMessageParam[] {
  const turns = normalizeTurns(request.turns)
  return turns.map((turn, index) => {
    if (turn.role === 'assistant') return { role: 'assistant', content: turn.text }
    const content: Anthropic.Beta.BetaTextBlockParam[] = []
    // The project's code goes first so it is cached and reused by the next messages.
    if (index === 0) content.push({ type: 'text', text: filesBlock(request), cache_control: CACHE })
    const isLast = index === turns.length - 1
    if (isLast && request.page) content.push({ type: 'text', text: `(The preview is showing the page ${request.page}.)` })
    content.push({ type: 'text', text: turn.text, ...(isLast ? { cache_control: CACHE } : {}) })
    return { role: 'user', content }
  })
}

/** Returns the validated proposal, or null when Claude only answered in text. */
export async function chat(
  apiKey: string,
  request: ChatRequest,
  emit: (event: ChatEvent) => void,
  usage: SuggestUsage,
  model: string,
): Promise<ChatProposal | null> {
  const client = new Anthropic({ apiKey })
  const messages = buildMessages(request)
  if (messages.at(-1)?.role !== 'user') throw new SuggestError('There is no message to answer.')

  for (let attempt = 1; attempt <= 2; attempt++) {
    let chars = 0
    let lastReport = 0
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 32000,
      // Re-runs the request on another model if a safety classifier declines it.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: CHAT_SYSTEM,
      tools: [{ ...PROPOSE_TOOL, eager_input_streaming: true }],
      messages,
    })
    // The fix-up round only resends the files; its text would repeat the first answer.
    if (attempt === 1) stream.on('text', (delta) => emit({ type: 'text', delta }))
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        emit({ type: 'status', message: attempt === 1 ? 'Writing the code…' : 'Fixing a few problems…' })
      }
    })
    stream.on('inputJson', (partial) => {
      chars += partial.length
      if (Date.now() - lastReport > 800) {
        lastReport = Date.now()
        emit({ type: 'progress', chars })
      }
    })
    const message = await stream.finalMessage()
    addUsage(usage, message)

    if (message.stop_reason === 'refusal') throw new SuggestError('AI declined this request.')
    if (message.stop_reason === 'max_tokens') {
      throw new SuggestError('The answer was too long. Try asking for a smaller change.')
    }
    const call = message.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use' && block.name === PROPOSE_TOOL.name,
    )
    if (!call) return null

    // Tool input streams eagerly, so check its shape here rather than trusting it.
    const proposal = { components: [], ...(call.input as object) } as unknown as ChatProposal
    const errors = validateChatProposal(request, proposal)
    if (errors.length === 0) return proposal
    if (attempt === 2) throw new SuggestError(`The proposed change still had problems: ${errors.slice(0, 3).join(' ')}`)
    // Append-only: keep Claude's answer and ask for corrected files.
    messages.push({ role: 'assistant', content: message.content })
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `The change wasn't shown to the student because it has problems. Call propose_changes again with all files corrected; don't write any other text.\n- ${errors.join('\n- ')}`,
        },
      ],
    })
  }
  return null
}
