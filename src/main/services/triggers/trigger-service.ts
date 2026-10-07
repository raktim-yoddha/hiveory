import { randomBytes, randomUUID } from 'node:crypto'
import type { Bot } from '@shared/domain/bot'
import type { TailnetStatus } from '@shared/domain/tailnet'
import { MAX_TRIGGER_NAME, type Trigger, type TriggerField, type TriggerLinkStatus, type TriggerType } from '@shared/domain/trigger'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { Emit } from '../events'
import { nowIso } from '../events'
import type { StateStore } from '../persistence/state-store'
import { TriggerIngress, type Delivery } from './trigger-ingress'
import { signatureProblem } from './webhook-signature'

/** Composio's REST API, through the user's saved key (AppService.api). */
export type ComposioApi = <T>(path: string, options?: { method?: string; body?: unknown; missingOk?: boolean }) => Promise<T | null>

export interface TriggerDeps {
  store: StateStore
  emit: Emit
  log: Logger
  composio: ComposioApi
  tailscale: { status(): Promise<TailnetStatus>; funnel(path: string, target: string | null): Promise<void> }
  /** Seals the webhook signing secret at rest (SecretBox). */
  secrets: { seal(value: string): string; open(sealed: string): string }
  bots: { find(botId: string): Bot | undefined }
  /** Starts a read-only run on the bot for one event (RoutineService.runEvent). */
  run(trigger: Trigger, data: unknown): void
  now?: () => number
}

export type TriggerInput = Pick<Trigger, 'name' | 'botId' | 'prompt' | 'appId' | 'accountId' | 'triggerSlug' | 'triggerName' | 'config'>

interface ComposioTriggerType {
  slug: string
  name: string
  description?: string
  config?: { properties?: Record<string, { type?: string; title?: string; description?: string; default?: unknown }>; required?: string[] }
}

interface Subscription {
  id: string
  webhook_url: string
  secret?: string
}

const EVENTS = ['composio.trigger.message']
/** Webhook deliveries remembered to drop Composio's retries of one already handled. */
const SEEN_DELIVERIES = 500

/** Tailscale's message when Funnel is not yet allowed carries the page that allows it. */
const fixUrlIn = (text: string): string | undefined => text.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0]

/**
 * Triggers (ADR 0028): Composio watches the user's apps and posts each event to a webhook. Hiveory
 * receives it on a loopback listener that Tailscale Funnel publishes at one random HTTPS path, checks
 * Composio's signature and timestamp, drops repeats, and starts a read-only run on the trigger's bot.
 * The Composio project's single webhook subscription is Hiveory's: created here, or taken over only when
 * the user says so, since its signing secret is shown just once.
 */
export class TriggerService {
  private readonly ingress: TriggerIngress
  private readonly seen: string[] = []
  private link: TriggerLinkStatus = { state: 'off' }
  private readonly now: () => number

  constructor(private readonly d: TriggerDeps) {
    this.now = d.now ?? Date.now
    this.ingress = new TriggerIngress(
      () => this.d.store.state.triggerLink?.path ?? '',
      (delivery) => this.receive(delivery)
    )
  }

  // ---------- the public link ----------

  status(): TriggerLinkStatus {
    return this.d.store.state.triggerLink?.enabled ? this.link : { state: 'off' }
  }

  /** After the state loads: a link left on is published again (the listener's port is new each start). */
  async start(): Promise<void> {
    if (!this.d.store.state.triggerLink?.enabled) return
    await this.publish().catch((error: unknown) => this.d.log.warn('Could not reopen the trigger link', error))
  }

  /** Turns the public link on: listener, Funnel path, and the Composio webhook pointed at it. */
  async enableLink(takeOver = false): Promise<TriggerLinkStatus> {
    const current = this.d.store.state.triggerLink
    const path = current?.path ?? `/hiveory/${randomBytes(16).toString('hex')}`
    this.d.store.update((s) => {
      s.triggerLink = { ...(s.triggerLink ?? { path }), enabled: true }
    })
    await this.publish(takeOver)
    return this.status()
  }

  /** Takes the Funnel path down. Composio keeps its subscription; events then fail until the link is back. */
  async disableLink(): Promise<TriggerLinkStatus> {
    const path = this.d.store.state.triggerLink?.path
    this.d.store.update((s) => {
      if (s.triggerLink) s.triggerLink.enabled = false
    })
    this.ingress.close()
    this.link = { state: 'off' }
    if (path) await this.d.tailscale.funnel(path, null).catch((error: unknown) => this.d.log.warn('Could not take the trigger link down', error))
    this.changed()
    return this.status()
  }

  /** On quit: the path stops pointing at a listener that is going away. */
  async close(): Promise<void> {
    this.ingress.close()
    const link = this.d.store.state.triggerLink
    if (link?.enabled) await this.d.tailscale.funnel(link.path, null).catch(() => undefined)
  }

  private async publish(takeOver = false): Promise<void> {
    const saved = this.d.store.state.triggerLink!
    try {
      const tailnet = await this.d.tailscale.status()
      if (tailnet.state === 'missing') return this.problem('Install Tailscale and sign in: events reach this computer through Tailscale Funnel.', 'https://tailscale.com/download')
      if (tailnet.state !== 'running' || !tailnet.self?.dnsName) return this.problem('Turn Tailscale on and sign in, with MagicDNS on, then try again.')
      const port = await this.ingress.port()
      try {
        await this.d.tailscale.funnel(saved.path, `http://127.0.0.1:${port}`)
      } catch (error) {
        const said = error instanceof Error ? error.message : String(error)
        return this.problem(`Tailscale Funnel is not available yet: ${said.split('\n')[0]}`, fixUrlIn(said) ?? 'https://tailscale.com/kb/1223/funnel')
      }
      const url = `https://${tailnet.self.dnsName.replace(/\.$/, '')}${saved.path}`
      const conflict = await this.subscribe(url, takeOver)
      if (conflict) {
        this.link = { state: 'error', url, detail: `Your Composio project already sends its webhook to ${conflict}. Hiveory needs that webhook for triggers.`, conflict }
        return this.changed()
      }
      this.link = { state: 'on', url }
      this.changed()
    } catch (error) {
      this.problem(error instanceof Error ? error.message : String(error))
    }
  }

  /** Points the project's one webhook subscription at Hiveory. Returns the other URL it uses, if it is someone else's. */
  private async subscribe(url: string, takeOver: boolean): Promise<string | null> {
    const saved = this.d.store.state.triggerLink!
    const listed = await this.d.composio<{ items?: Subscription[] } | Subscription[]>('/webhook_subscriptions')
    const existing = (Array.isArray(listed) ? listed : (listed?.items ?? []))[0]
    if (!existing) {
      const created = await this.d.composio<Subscription>('/webhook_subscriptions', { method: 'POST', body: { webhook_url: url, enabled_events: EVENTS, version: 'V3' } })
      if (!created?.id || !created.secret) fail('UNEXPECTED', 'Composio did not return a webhook secret.')
      this.saveSubscription(created!.id, created!.secret!)
      return null
    }
    const ours = existing.id === saved.subscriptionId && saved.secret
    if (!ours && !takeOver) return existing.webhook_url
    if (existing.webhook_url !== url) {
      await this.d.composio(`/webhook_subscriptions/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: { webhook_url: url, enabled_events: EVENTS } })
    }
    if (!ours) {
      // Taking over: a new secret only Hiveory knows (the old one was shown once, to someone else).
      const rotated = await this.d.composio<Subscription>(`/webhook_subscriptions/${encodeURIComponent(existing.id)}/rotate_secret`, { method: 'POST' })
      if (!rotated?.secret) fail('UNEXPECTED', 'Composio did not return a new webhook secret.')
      this.saveSubscription(existing.id, rotated!.secret!)
    }
    return null
  }

  private saveSubscription(subscriptionId: string, secret: string): void {
    this.d.store.update((s) => {
      if (s.triggerLink) Object.assign(s.triggerLink, { subscriptionId, secret: this.d.secrets.seal(secret) })
    })
  }

  private problem(detail: string, fixUrl?: string): void {
    this.link = { state: 'error', detail, ...(fixUrl ? { fixUrl } : {}) }
    this.changed()
  }

  // ---------- events ----------

  /** One webhook delivery: signed, fresh, new, and for an enabled trigger of a bot allowed to act on its own. */
  receive(delivery: Delivery): boolean {
    const sealed = this.d.store.state.triggerLink?.secret
    if (!sealed || signatureProblem(delivery.headers, delivery.body, this.d.secrets.open(sealed), this.now())) return false
    const id = delivery.headers.id!
    if (this.seen.includes(id)) return true
    this.seen.push(id)
    if (this.seen.length > SEEN_DELIVERIES) this.seen.shift()
    let event: { metadata?: { trigger_id?: string }; data?: unknown }
    try {
      event = JSON.parse(delivery.body) as typeof event
    } catch {
      return true
    }
    const trigger = this.d.store.state.triggers.find((t) => t.instanceId === event.metadata?.trigger_id)
    if (!trigger?.enabled) return true
    this.d.store.update((s) => {
      const t = s.triggers.find((x) => x.id === trigger.id)
      if (t) t.lastEventAt = nowIso()
    })
    this.d.run(trigger, event.data ?? {})
    this.changed()
    return true
  }

  // ---------- triggers ----------

  list(): Trigger[] {
    return this.d.store.state.triggers.map((t) => ({ ...t }))
  }

  /** The events an app offers, with the settings each one needs. */
  async types(appId: string): Promise<TriggerType[]> {
    const listed = await this.d.composio<{ items?: ComposioTriggerType[] }>(`/triggers_types?toolkit_slugs=${encodeURIComponent(appId)}&limit=50`)
    return (listed?.items ?? []).map((t) => ({ slug: t.slug, name: t.name, description: t.description ?? '', fields: fieldsOf(t.config) }))
  }

  async create(input: TriggerInput): Promise<Trigger> {
    const bot = this.d.bots.find(input.botId) ?? fail('NOT_FOUND', 'Bot not found.')
    if (!bot.routines) fail('INVALID_INPUT', `Allow ${bot.name} to work on its own first (its "Runs on a schedule" switch).`)
    const name = input.name.trim().slice(0, MAX_TRIGGER_NAME)
    if (!name) fail('INVALID_INPUT', 'Name the trigger.')
    const made = await this.d.composio<{ trigger_id?: string; triggerId?: string; id?: string }>(`/trigger_instances/${encodeURIComponent(input.triggerSlug)}/upsert`, {
      method: 'POST',
      body: { connected_account_id: input.accountId, trigger_config: input.config }
    })
    const instanceId = made?.trigger_id ?? made?.triggerId ?? made?.id
    if (!instanceId) fail('UNEXPECTED', 'Composio did not create the trigger.')
    const now = nowIso()
    const trigger: Trigger = { id: randomUUID(), ...input, name, prompt: input.prompt.trim(), instanceId: instanceId!, enabled: true, createdAt: now, updatedAt: now }
    this.d.store.update((s) => {
      s.triggers.push(trigger)
    })
    this.changed()
    return trigger
  }

  async update(triggerId: string, patch: Partial<Pick<Trigger, 'name' | 'prompt' | 'enabled' | 'botId'>>): Promise<Trigger> {
    const trigger = this.get(triggerId)
    if (patch.botId && !this.d.bots.find(patch.botId)) fail('NOT_FOUND', 'Bot not found.')
    if (patch.enabled !== undefined && patch.enabled !== trigger.enabled) {
      await this.d.composio(`/trigger_instances/manage/${encodeURIComponent(trigger.instanceId)}`, { method: 'PATCH', body: { status: patch.enabled ? 'enable' : 'disable' }, missingOk: true })
    }
    this.d.store.update((s) => {
      const t = s.triggers.find((x) => x.id === triggerId)
      if (t) Object.assign(t, patch, { updatedAt: nowIso() })
    })
    this.changed()
    return this.get(triggerId)
  }

  /** Removes it here and at Composio (already gone there is fine). */
  async delete(triggerId: string): Promise<void> {
    const trigger = this.get(triggerId)
    await this.d.composio(`/trigger_instances/manage/${encodeURIComponent(trigger.instanceId)}`, { method: 'DELETE', missingOk: true })
    this.d.store.update((s) => {
      s.triggers = s.triggers.filter((t) => t.id !== triggerId)
    })
    this.changed()
  }

  /** A deleted bot's triggers go too (at Composio as well). */
  async removeForBot(botId: string): Promise<void> {
    for (const t of this.d.store.state.triggers.filter((x) => x.botId === botId)) await this.delete(t.id).catch(() => undefined)
  }

  private get(triggerId: string): Trigger {
    return this.d.store.state.triggers.find((t) => t.id === triggerId) ?? fail('NOT_FOUND', 'Trigger not found.')
  }

  private changed(): void {
    this.d.emit('state.changed', { topic: 'triggers' })
  }
}

/** Composio's config schema as simple form fields: text, number or yes/no. */
export function fieldsOf(config: ComposioTriggerType['config']): TriggerField[] {
  const required = new Set(config?.required ?? [])
  return Object.entries(config?.properties ?? {}).map(([key, p]) => {
    const type = p.type === 'integer' || p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string'
    const fallback = p.default
    return {
      key,
      label: p.title || key.replace(/_/g, ' '),
      ...(p.description ? { description: p.description } : {}),
      type,
      required: required.has(key),
      ...(typeof fallback === 'string' || typeof fallback === 'number' || typeof fallback === 'boolean' ? { default: fallback } : {})
    }
  })
}
