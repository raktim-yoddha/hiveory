import { randomBytes } from 'node:crypto'
import type { QueenContext } from '@shared/queen/actions'
import {
  isAllowedBrainUrl,
  PLAN_TOOL,
  planFromToolArgs,
  presetOf,
  accountName,
  stateMessage,
  systemPrompt,
  type BrainAccountView,
  type BrainKind,
  type BrainResult
} from '@shared/queen/brain'
import { PERSONAS, type PersonaId } from '@shared/queen/personas'
import { AppException, fail } from '@shared/errors'
import type { SecretBox } from '../connections/secret-box'
import type { StateStore } from '../persistence/state-store'
import type { StoredBrainAccount } from '../persistence/schema'

/** A model gets this long to plan; past it, Queen Bee moves to the next account or says so. */
export const BRAIN_BUDGET_MS = 8000
const LIST_BUDGET_MS = 10_000
const MAX_ACCOUNTS = 20

type Fetch = typeof fetch

export interface AccountInput {
  id?: string
  provider: string
  label: string
  /** Only for custom providers; known providers keep their own format. */
  kind?: BrainKind
  baseUrl: string
  model: string
  /** undefined keeps the saved key, '' or null removes it. */
  apiKey?: string | null
  enabled?: boolean
}

const newId = (): string => `q${randomBytes(6).toString('hex')}`

/**
 * Queen Bee's model tier (ADR 0019). Holds any number of provider accounts —
 * several per provider — tried in order: the first enabled one plans, the next
 * takes over if it fails. Speaks OpenAI-compatible, Anthropic and Gemini wire
 * formats, always forcing one `plan` tool call with reasoning at its minimum.
 * Keys are sealed at rest, never returned to the renderer and never echoed.
 */
export class QueenBrain {
  /** Models that rejected the "think less" hint: asked again without it. */
  private readonly noHint = new Set<string>()

  constructor(
    private readonly store: StateStore,
    private readonly box: SecretBox,
    private readonly http: Fetch = fetch
  ) {}

  private all(): StoredBrainAccount[] {
    return this.store.state.queenBrains
  }

  private view(a: StoredBrainAccount): BrainAccountView {
    return { id: a.id, provider: a.provider, label: a.label, kind: a.kind, baseUrl: a.baseUrl, model: a.model, enabled: a.enabled, hasKey: Boolean(a.key), encrypted: this.box.encrypted }
  }

  accounts(): BrainAccountView[] {
    return this.all().map((a) => this.view(a))
  }

  private usable(a: StoredBrainAccount): boolean {
    return a.enabled && Boolean(a.model && a.baseUrl) && (Boolean(a.key) || !presetOf(a.provider).keyRequired)
  }

  get configured(): boolean {
    return this.all().some((a) => this.usable(a))
  }

  save(input: AccountInput): BrainAccountView[] {
    const preset = presetOf(input.provider)
    const existing = input.id ? this.all().find((a) => a.id === input.id) : undefined
    if (input.id && !existing) fail('NOT_FOUND', 'That account no longer exists.')
    if (!existing && this.all().length >= MAX_ACCOUNTS) fail('INVALID_INPUT', `Up to ${MAX_ACCOUNTS} accounts.`)
    const kind: BrainKind = preset.id === 'custom' ? (input.kind ?? 'openai') : preset.kind
    const baseUrl = (input.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, '')
    if (!isAllowedBrainUrl(baseUrl)) fail('INVALID_INPUT', 'Use an https address (plain http only for this computer).')
    const label = input.label.trim().slice(0, 40)
    const clash = this.all().find((a) => a.id !== existing?.id && a.provider === input.provider && a.label.toLowerCase() === label.toLowerCase())
    if (clash) fail('INVALID_INPUT', `${accountName(clash)} already exists. Give this account another name (for example Work or Personal).`)
    const key =
      input.apiKey === undefined ? (existing && existing.provider === input.provider ? existing.key : '') : input.apiKey ? this.box.seal(input.apiKey.trim()) : ''
    const next: StoredBrainAccount = {
      id: existing?.id ?? newId(),
      provider: preset.id,
      label,
      kind,
      baseUrl,
      model: input.model.trim(),
      key,
      enabled: input.enabled ?? existing?.enabled ?? true
    }
    this.store.update((s) => {
      const i = s.queenBrains.findIndex((a) => a.id === next.id)
      if (i < 0) s.queenBrains.push(next)
      else s.queenBrains[i] = next
    })
    return this.accounts()
  }

  remove(id: string): BrainAccountView[] {
    this.store.update((s) => {
      s.queenBrains = s.queenBrains.filter((a) => a.id !== id)
    })
    return this.accounts()
  }

  /** Moves an account to a position (0 = primary). */
  move(id: string, to: number): BrainAccountView[] {
    this.store.update((s) => {
      const from = s.queenBrains.findIndex((a) => a.id === id)
      if (from < 0) return
      const [item] = s.queenBrains.splice(from, 1)
      s.queenBrains.splice(Math.max(0, Math.min(to, s.queenBrains.length)), 0, item!)
    })
    return this.accounts()
  }

  /** One small real request through this account: proves the key, model and tool calling. */
  async test(id: string): Promise<{ ms: number; detail: string }> {
    const account = this.all().find((a) => a.id === id) ?? fail('NOT_FOUND', 'That account no longer exists.')
    const started = Date.now()
    const ctx: QueenContext = { mode: 'workspace', projects: [], workspaces: [], agents: [], clis: [], presets: [] }
    const result = await this.planWith(account, 'open the settings', ctx, 'ada')
    const ms = Date.now() - started
    if (result.kind === 'actions' && result.actions[0]?.type === 'navigate') return { ms, detail: 'Tool calling works.' }
    return fail('INVALID_INPUT', 'The model answered but did not call the tool correctly. Try a different model.')
  }

  /**
   * The provider's own model list. Uses the key typed in the form, or the saved key
   * of `id`. Providers that publish no list simply return none: the user types the name.
   */
  async listModels(input: { id?: string; provider: string; kind?: BrainKind; baseUrl: string; apiKey?: string }): Promise<string[]> {
    const preset = presetOf(input.provider)
    const kind = preset.id === 'custom' ? (input.kind ?? 'openai') : preset.kind
    const baseUrl = (input.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, '')
    if (!isAllowedBrainUrl(baseUrl)) fail('INVALID_INPUT', 'Use an https address (plain http only for this computer).')
    const saved = input.id ? this.all().find((a) => a.id === input.id) : undefined
    const key = input.apiKey?.trim() || (saved?.key ? this.box.open(saved.key) : '')
    const { url, headers } =
      kind === 'anthropic'
        ? { url: `${baseUrl}/models?limit=1000`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
        : kind === 'gemini'
          ? { url: `${baseUrl}/models?pageSize=1000`, headers: { 'x-goog-api-key': key } }
          : { url: `${baseUrl}/models`, headers: key ? { Authorization: `Bearer ${key}` } : ({} as Record<string, string>) }
    let res: Response
    try {
      res = await this.http(url, { headers, signal: AbortSignal.timeout(LIST_BUDGET_MS) })
    } catch {
      return fail('INVALID_INPUT', `Could not reach ${new URL(url).host}.`)
    }
    if (!res.ok) fail('INVALID_INPUT', httpMessage(res.status))
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const ids =
      kind === 'gemini'
        ? ((data.models as Array<{ name?: string; supportedGenerationMethods?: string[] }> | undefined) ?? [])
            .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
            .map((m) => (m.name ?? '').replace(/^models\//, ''))
        : ((data.data as Array<{ id?: string }> | undefined) ?? (data.models as Array<{ id?: string; name?: string }> | undefined) ?? []).map((m) => m.id ?? (m as { name?: string }).name ?? '')
    return [...new Set(ids.filter((m) => typeof m === 'string' && m.length > 0 && m.length < 200))].sort((a, b) => a.localeCompare(b))
  }

  /** Plans with the first enabled account; any failure hands the request to the next. */
  async plan(utterance: string, ctx: QueenContext, persona: PersonaId): Promise<BrainResult> {
    const accounts = this.all().filter((a) => this.usable(a))
    if (!accounts.length) fail('NOT_FOUND', 'Queen Bee has no model yet. Add one in Settings › Queen Bee › Providers.')
    let last: unknown
    for (const account of accounts) {
      try {
        return await this.planWith(account, utterance, ctx, persona)
      } catch (error) {
        last = error
      }
    }
    const message = last instanceof AppException ? last.error.message : 'Every model failed.'
    return fail('INVALID_INPUT', accounts.length > 1 ? `All ${accounts.length} accounts failed. Last: ${message}` : message)
  }

  private async planWith(account: StoredBrainAccount, utterance: string, ctx: QueenContext, persona: PersonaId): Promise<BrainResult> {
    const key = account.key ? this.box.open(account.key) : ''
    if (account.key && !key) fail('INVALID_INPUT', `The key of ${accountName(account)} can't be read on this account. Enter it again.`)
    const args = await this.call(account, key, systemPrompt(PERSONAS[persona]), stateMessage(ctx, utterance))
    return planFromToolArgs(args, ctx)
  }

  private async call(a: StoredBrainAccount, key: string, system: string, user: string): Promise<unknown> {
    const hintKey = `${a.baseUrl}:${a.model}`
    const withHint = !this.noHint.has(hintKey)
    try {
      return await this.request(a, key, system, user, withHint)
    } catch (error) {
      // Not every model accepts "reasoning effort" / "thinking" knobs: retry once without, and remember.
      if (withHint && error instanceof HintRejected) {
        this.noHint.add(hintKey)
        return this.request(a, key, system, user, false)
      }
      throw error
    }
  }

  private async request(a: StoredBrainAccount, key: string, system: string, user: string, hint: boolean): Promise<unknown> {
    const { url, headers, body } = build(a.kind, a, key, system, user, hint)
    let res: Response
    try {
      res = await this.http(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(BRAIN_BUDGET_MS) })
    } catch (error) {
      const name = (error as { name?: string })?.name
      if (name === 'TimeoutError' || name === 'AbortError') fail('INVALID_INPUT', `${accountName(a)} took longer than ${BRAIN_BUDGET_MS / 1000} s.`)
      return fail('INVALID_INPUT', `Could not reach ${new URL(url).host}.`)
    }
    const text = await res.text()
    if (!res.ok) {
      const detail = scrub(text, key)
      if (hint && res.status === 400 && /reason|think|effort|budget/i.test(detail)) throw new HintRejected()
      fail('INVALID_INPUT', `${accountName(a)}: ${httpMessage(res.status)}`, { detail: detail.slice(0, 300) })
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      fail('INVALID_INPUT', `${accountName(a)} sent an unreadable answer.`)
    }
    return extract(a.kind, data)
  }
}

class HintRejected extends Error {}

const httpMessage = (status: number): string =>
  status === 401 || status === 403
    ? 'the provider rejected the API key.'
    : status === 404
      ? 'model or address not found. Check the model name.'
      : status === 429
        ? 'rate limited. Try again shortly.'
        : status >= 500
          ? 'the provider had an error. Try again.'
          : `the provider refused the request (${status}).`

/** Error bodies are shown to the user: never let the key ride along. */
const scrub = (text: string, key: string): string => (key ? text.split(key).join('••••') : text)

/** The wire format of each provider kind, with one forced `plan` call. */
function build(kind: BrainKind, b: { baseUrl: string; model: string }, key: string, system: string, user: string, hint: boolean) {
  if (kind === 'anthropic') {
    return {
      url: `${b.baseUrl}/messages`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: {
        model: b.model,
        max_tokens: 1024,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        tools: [{ name: PLAN_TOOL.name, description: PLAN_TOOL.description, input_schema: PLAN_TOOL.parameters }],
        tool_choice: { type: 'tool', name: PLAN_TOOL.name }
      }
    }
  }
  if (kind === 'gemini') {
    return {
      // The key goes in a header, never in the URL (URLs end up in logs).
      url: `${b.baseUrl}/models/${encodeURIComponent(b.model)}:generateContent`,
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        tools: [{ functionDeclarations: [{ name: PLAN_TOOL.name, description: PLAN_TOOL.description, parameters: PLAN_TOOL.parameters }] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [PLAN_TOOL.name] } },
        ...(hint ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : {})
      }
    }
  }
  return {
    url: `${b.baseUrl}/chat/completions`,
    headers: key ? { Authorization: `Bearer ${key}` } : ({} as Record<string, string>),
    body: {
      model: b.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      tools: [{ type: 'function', function: { name: PLAN_TOOL.name, description: PLAN_TOOL.description, parameters: PLAN_TOOL.parameters } }],
      tool_choice: { type: 'function', function: { name: PLAN_TOOL.name } },
      ...(hint ? { reasoning_effort: b.baseUrl.includes('api.openai.com') ? 'minimal' : 'low' } : {})
    }
  }
}

/** The `plan` arguments from each provider's answer shape. */
function extract(kind: BrainKind, data: unknown): unknown {
  const d = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  if (kind === 'anthropic') return (d.content as Array<{ type: string; input?: unknown }> | undefined)?.find((c) => c.type === 'tool_use')?.input ?? {}
  if (kind === 'gemini') {
    const parts = (d.candidates?.[0]?.content?.parts ?? []) as Array<{ functionCall?: { args?: unknown } }>
    return parts.find((p) => p.functionCall)?.functionCall?.args ?? {}
  }
  const message = d.choices?.[0]?.message ?? {}
  const call = message.tool_calls?.[0]?.function?.arguments
  // Some local servers answer in plain JSON content instead of a tool call.
  const raw = typeof call === 'string' ? call : typeof message.content === 'string' ? message.content.replace(/^```(?:json)?|```$/g, '').trim() : ''
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
