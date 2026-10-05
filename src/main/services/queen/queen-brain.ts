import type { QueenContext } from '@shared/queen/actions'
import { BRAIN_PRESETS, isAllowedBrainUrl, PLAN_TOOL, planFromToolArgs, stateMessage, systemPrompt, type BrainKind, type BrainResult, type BrainView } from '@shared/queen/brain'
import { PERSONAS, type PersonaId } from '@shared/queen/personas'
import { fail } from '@shared/errors'
import type { SecretBox } from '../connections/secret-box'
import type { StateStore } from '../persistence/state-store'

/** A model gets this long to plan; past it, Queen Bee says so instead of hanging. */
export const BRAIN_BUDGET_MS = 8000

type Fetch = typeof fetch

/**
 * Queen Bee's model tier (ADR 0019). Speaks three wire formats (OpenAI-compatible,
 * Anthropic, Gemini) and always forces one `plan` tool call with reasoning at its
 * minimum. The key is sealed at rest, never returned to the renderer and never
 * echoed in an error.
 */
export class QueenBrain {
  /** Models that rejected the "think less" hint: asked again without it. */
  private readonly noHint = new Set<string>()

  constructor(
    private readonly store: StateStore,
    private readonly box: SecretBox,
    private readonly http: Fetch = fetch
  ) {}

  view(): BrainView {
    const b = this.store.state.queenBrain
    return { provider: b?.provider ?? null, baseUrl: b?.baseUrl ?? '', model: b?.model ?? '', hasKey: Boolean(b?.key), encrypted: this.box.encrypted }
  }

  get configured(): boolean {
    const b = this.store.state.queenBrain
    return Boolean(b?.model && b.baseUrl && (b.key || !this.preset(b.provider).keyRequired))
  }

  /** `apiKey`: undefined keeps the saved key, '' or null removes it. Provider null forgets the brain. */
  configure(input: { provider: string | null; baseUrl: string; model: string; apiKey?: string | null }): BrainView {
    if (input.provider === null) {
      this.store.update((s) => {
        s.queenBrain = null
      })
      return this.view()
    }
    const preset = this.preset(input.provider)
    const baseUrl = (input.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, '')
    if (!isAllowedBrainUrl(baseUrl)) fail('INVALID_INPUT', 'Use an https address (plain http only for this computer).')
    const previous = this.store.state.queenBrain
    const key = input.apiKey === undefined ? (previous?.provider === input.provider ? previous.key : '') : input.apiKey ? this.box.seal(input.apiKey.trim()) : ''
    this.store.update((s) => {
      s.queenBrain = { provider: input.provider!, baseUrl, model: input.model.trim(), key }
    })
    return this.view()
  }

  /** One small real request: proves the key, model and tool calling all work. */
  async test(): Promise<{ ms: number; detail: string }> {
    const started = Date.now()
    const ctx: QueenContext = { mode: 'workspace', projects: [], workspaces: [], agents: [], clis: [], presets: [] }
    const result = await this.plan('open the settings', ctx, 'ada')
    const ms = Date.now() - started
    if (result.kind === 'actions' && result.actions[0]?.type === 'navigate') return { ms, detail: 'Tool calling works.' }
    return fail('INVALID_INPUT', 'The model answered but did not call the tool correctly. Try a different model.')
  }

  async plan(utterance: string, ctx: QueenContext, persona: PersonaId): Promise<BrainResult> {
    const b = this.store.state.queenBrain
    if (!b || !this.configured) fail('NOT_FOUND', 'Queen Bee has no model yet. Add one in Settings › Queen Bee.')
    const key = b!.key ? this.box.open(b!.key) : ''
    if (b!.key && !key) fail('INVALID_INPUT', 'The saved key cannot be read on this account. Enter it again.')
    const kind = this.preset(b!.provider).kind
    const system = systemPrompt(PERSONAS[persona])
    const user = stateMessage(ctx, utterance)
    const args = await this.call(kind, b!, key, system, user)
    return planFromToolArgs(args, ctx)
  }

  private preset(provider: string) {
    return BRAIN_PRESETS.find((p) => p.id === provider) ?? BRAIN_PRESETS.find((p) => p.id === 'custom')!
  }

  private async call(kind: BrainKind, b: { provider: string; baseUrl: string; model: string }, key: string, system: string, user: string): Promise<unknown> {
    const hintKey = `${b.provider}:${b.model}`
    const withHint = !this.noHint.has(hintKey)
    try {
      return await this.request(kind, b, key, system, user, withHint)
    } catch (error) {
      // Not every model accepts "reasoning effort" / "thinking" knobs: retry once without, and remember.
      if (withHint && error instanceof HintRejected) {
        this.noHint.add(hintKey)
        return this.request(kind, b, key, system, user, false)
      }
      throw error
    }
  }

  private async request(kind: BrainKind, b: { provider: string; baseUrl: string; model: string }, key: string, system: string, user: string, hint: boolean): Promise<unknown> {
    const { url, headers, body } = build(kind, b, key, system, user, hint)
    let res: Response
    try {
      res = await this.http(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(BRAIN_BUDGET_MS) })
    } catch (error) {
      const name = (error as { name?: string })?.name
      if (name === 'TimeoutError' || name === 'AbortError') fail('INVALID_INPUT', `The model took longer than ${BRAIN_BUDGET_MS / 1000} s.`)
      fail('INVALID_INPUT', `Could not reach ${new URL(url).host}.`)
    }
    const text = await res!.text()
    if (!res!.ok) {
      const detail = scrub(text, key)
      if (hint && res!.status === 400 && /reason|think|effort|budget/i.test(detail)) throw new HintRejected()
      fail('INVALID_INPUT', httpMessage(res!.status), { detail: detail.slice(0, 300) })
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      fail('INVALID_INPUT', 'The provider sent an unreadable answer.')
    }
    return extract(kind, data)
  }
}

class HintRejected extends Error {}

const httpMessage = (status: number): string =>
  status === 401 || status === 403
    ? 'The provider rejected the API key.'
    : status === 404
      ? 'Model or address not found. Check the model name.'
      : status === 429
        ? 'The provider is rate limiting this key. Try again shortly.'
        : status >= 500
          ? 'The provider had an error. Try again.'
          : `The provider refused the request (${status}).`

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
    headers: key ? { Authorization: `Bearer ${key}` } : {},
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
