import type { ChatModelSummary } from '../../../../shared/api/hiveory-client'

const PROVIDER_LABELS: Record<string, string> = {
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
}

const TOKEN_LABELS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  cf: 'CF',
  cli: 'CLI',
  cloudflare: 'Cloudflare',
  deepseek: 'DeepSeek',
  github: 'GitHub',
  glm: 'GLM',
  gpt: 'GPT',
  minimax: 'MiniMax',
  openai: 'OpenAI',
  opencode: 'OpenCode',
  openrouter: 'OpenRouter',
  qwen: 'Qwen',
  xai: 'xAI',
}

function labelToken(token: string): string {
  const knownLabel = TOKEN_LABELS[token.toLowerCase()]
  if (knownLabel) return knownLabel
  if (/^\d+(?:\.\d+)?[a-z]+$/i.test(token)) {
    return token.replace(/[a-z]+$/i, (suffix) => suffix.toUpperCase())
  }
  if (/^[rv]\d/i.test(token)) {
    return `${token[0].toUpperCase()}${token.slice(1)}`
  }
  if (/^[A-Z0-9.]+$/.test(token)) return token
  return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`
}

function humanize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(labelToken)
    .join(' ')
}

function modelNameFrom(value: string): string {
  const trimmed = value.trim().replace(/^~+/, '')
  if (!trimmed) return 'Unnamed model'

  const suffixMatch = trimmed.match(/:([a-z0-9-]+)$/i)
  const suffixStart = suffixMatch?.index ?? trimmed.length
  const base = suffixMatch ? trimmed.slice(0, suffixStart) : trimmed
  const name = humanize(base)
  if (!name) return 'Unnamed model'
  const suffixLabel = suffixMatch?.[1].toLowerCase() === 'free' ? 'free' : humanize(suffixMatch?.[1] ?? '')
  return suffixMatch ? `${name} (${suffixLabel})` : name
}

function providerNameFrom(value: string): string {
  const normalized = value.trim().toLowerCase()
  return PROVIDER_LABELS[normalized] ?? humanize(value)
}

function modelDisplayName(model: Pick<ChatModelSummary, 'id' | 'display_name'>, idParts: string[]): string {
  const displayName = model.display_name.trim()
  const hasReadableDisplayName = displayName.length > 0 && displayName !== model.id && !displayName.includes('/')
  if (hasReadableDisplayName) return displayName

  return idParts[idParts.length - 1] ?? (displayName || model.id)
}

export function openCodeModelParts(model: Pick<ChatModelSummary, 'id' | 'display_name'>): {
  modelName: string
  providerName: string
} {
  const idParts = model.id.split('/').filter(Boolean)
  const providerId = idParts.length > 1 ? idParts[0] : ''
  const rawModelName = modelDisplayName(model, idParts)

  return {
    modelName: modelNameFrom(rawModelName),
    providerName: providerId ? providerNameFrom(providerId) : 'OpenCode',
  }
}
