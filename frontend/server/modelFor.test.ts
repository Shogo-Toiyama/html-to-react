import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, modelFor } from './suggest'

describe('modelFor', () => {
  it('uses the default when nothing is set', () => {
    expect(modelFor('components')).toBe(DEFAULT_MODELS.components)
    expect(modelFor('chat', {})).toBe(DEFAULT_MODELS.chat)
  })
  it('reads MODEL_<STEP> and accepts aliases or ids', () => {
    expect(modelFor('tailwind-cleanup', { MODEL_TAILWIND_CLEANUP: 'haiku' })).toBe('claude-haiku-5-5')
    expect(modelFor('props', { MODEL_PROPS: ' Sonnet ' })).toBe('claude-sonnet-5-5')
    expect(modelFor('chat', { MODEL_CHAT: 'claude-opus-5-5' })).toBe('claude-opus-5-5')
  })
  it('ignores an empty value and other steps', () => {
    expect(modelFor('tailwind', { MODEL_TAILWIND: '  ', MODEL_PROPS: 'haiku' })).toBe(DEFAULT_MODELS.tailwind)
  })
})
