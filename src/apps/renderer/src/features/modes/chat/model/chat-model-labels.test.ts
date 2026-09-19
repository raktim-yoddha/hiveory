import { describe, expect, it } from 'vitest'
import { openCodeModelParts } from './chat-model-labels'

function model(id: string, displayName = id) {
  return { id, display_name: displayName }
}

describe('openCodeModelParts', () => {
  it('uses the final path segment as the model and the first as the provider', () => {
    expect(openCodeModelParts(model('openrouter/~deepseek/deepseek-pro-latest'))).toEqual({
      modelName: 'DeepSeek Pro Latest',
      providerName: 'OpenRouter',
    })
  })

  it('removes scoped namespaces while preserving the actual provider label', () => {
    expect(openCodeModelParts(model('cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813'))).toEqual({
      modelName: 'DeepSeek V4 Pro 0813',
      providerName: 'Cloudflare Workers AI',
    })
  })

  it('formats OpenCode Go models without exposing the provider slash', () => {
    expect(openCodeModelParts(model('opencode-go/deepseek-v4-flash-vision-exp'))).toEqual({
      modelName: 'DeepSeek V4 Flash Vision Exp',
      providerName: 'OpenCode Go',
    })
  })

  it('falls back to OpenCode for models without a provider prefix', () => {
    expect(openCodeModelParts(model('default', 'Provider default'))).toEqual({
      modelName: 'Provider Default',
      providerName: 'OpenCode',
    })
  })

  it('turns catalog suffixes into readable badges', () => {
    expect(openCodeModelParts(model('openrouter/cohere/north-mini-code:free'))).toEqual({
      modelName: 'North Mini Code (free)',
      providerName: 'OpenRouter',
    })
  })
})
