import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Eye, ListTodo, LockOpen, RefreshCw, Search, ShieldQuestion, Star, Zap } from 'lucide-react'
import type { ChatModel } from '@shared/domain/chat'
import { CliLogo } from '../../components/cli/CliLogo'
import { IconButton } from '../../components/ui/Button'
import { Popover } from '../../components/ui/Popover'
import { Tabs } from '../../components/ui/Tabs'
import { cx } from '../../lib/cx'
import { useChat } from '../../stores/chat'
import { useClis } from '../../stores/data'
import { EffortIcon } from './EffortIcon'
import styles from './AgentPicker.module.css'

/** What one chat runs with: its CLI and model, effort, fast and plan mode, and what it may do. */
export interface AgentSetup {
  cliId: string
  model: string
  effort: string
  fast: boolean
  plan: boolean
  autoApprove: boolean
  /** Ask before each tool, on CLIs whose catalog says they can (ADR 0073). */
  ask: boolean
}

/** What the agent may do, as the picker shows it: Ask only on a CLI that asks (ADR 0073). */
const ACCESS = {
  read: { label: 'Read-only', icon: Eye },
  ask: { label: 'Ask first', icon: ShieldQuestion },
  full: { label: 'Full access', icon: LockOpen }
} as const

const accessOf = (setup: Pick<AgentSetup, 'autoApprove' | 'ask'>, asks: boolean): keyof typeof ACCESS => (setup.autoApprove ? 'full' : setup.ask && asks ? 'ask' : 'read')

interface AgentPickerProps extends AgentSetup {
  /** Lists every chat CLI; else only the chat's own. */
  switchable: boolean
  /** True once the chat has messages: another CLI takes the conversation over (ADR 0058). */
  started: boolean
  onChange(patch: Partial<AgentSetup>): void
}

const SHOWN_BEFORE_MORE = 8
const MAX_VISIBLE_MODELS = 250
const FAVORITES = '★'
const FAVORITES_KEY = 'hiveory.favoriteModels'

type Favorite = { cliId: string; id: string; label: string }

const readFavorites = (): Favorite[] => {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as unknown
    return Array.isArray(list) ? (list as Favorite[]).filter((f) => typeof f?.cliId === 'string' && typeof f.id === 'string') : []
  } catch {
    return []
  }
}

const saveFavorites = (list: Favorite[]): void => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list))
  } catch {
    // Stars are a convenience; they last for this window.
  }
}

const matches = (m: ChatModel, q: string): boolean => `${m.label} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(q)
const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/**
 * The chat's whole setup in one menu (ADR 0064): CLIs down a rail (starred models first), the
 * chosen CLI's models with search and Ctrl+1–9, the model's reasoning effort beside them, and along
 * the bottom Standard or Fast, Plan mode and what the agent may do. Picking a model of another CLI
 * switches both; the menu stays open until you are done.
 */
export function AgentPicker({ cliId, model, effort, fast, plan, autoApprove, ask, switchable, started, onChange }: AgentPickerProps) {
  const catalogs = useChat((s) => s.catalogs)
  const clis = useClis((s) => s.clis)
  const current = catalogs[cliId]
  const loaded = current && current !== 'loading' ? current : undefined
  const currentModel = loaded?.models.find((m) => m.id === model)
  const shownEffort = effort || currentModel?.defaultEffort
  const cliName = (id: string): string => clis.find((c) => c.id === id)?.displayName ?? id
  const access = ACCESS[accessOf({ autoApprove, ask }, Boolean(loaded?.prompts))]

  return (
    <Popover
      label="Choose CLI, model, effort and access"
      placement="above"
      width="xxl"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={styles.trigger}
          title={`${cliName(cliId)} · ${currentModel?.id || 'default model'}${shownEffort ? ` · ${shownEffort} effort` : ''} · ${access.label}${fast ? ' · Fast' : ''}${plan ? ' · Plan mode' : ''}`}
        >
          <CliLogo cliId={cliId} size="sm" />
          <span className={styles.triggerText}>{current === 'loading' ? 'Loading models…' : (currentModel?.label ?? 'Default model')}</span>
          {shownEffort && currentModel?.efforts?.length ? <span className={styles.triggerMeta}>{capitalize(shownEffort)}</span> : null}
          {fast && <Zap aria-label="Fast" className={styles.triggerIcon} />}
          {plan && <ListTodo aria-label="Plan mode" className={styles.triggerIcon} />}
          <access.icon aria-label={access.label} className={styles.triggerIcon} />
          <ChevronDown aria-hidden className={styles.chevron} />
        </button>
      )}
    >
      {() => (
        <PickerBody
          setup={{ cliId, model, effort, fast, plan, autoApprove, ask }}
          clis={switchable ? undefined : [cliId]}
          cliName={cliName}
          started={started}
          onChange={onChange}
        />
      )}
    </Popover>
  )
}

interface PickerBodyProps {
  setup: AgentSetup
  /** Only these CLIs (a terminal agent's chat keeps its CLI); undefined: every chat CLI. */
  clis?: string[]
  cliName(id: string): string
  started: boolean
  onChange(patch: Partial<AgentSetup>): void
}

function PickerBody({ setup, clis: only, cliName, started, onChange }: PickerBodyProps) {
  const { catalogs, loadCatalog, clis: chatClis } = useChat()
  const clis = useMemo(() => only ?? (chatClis.length ? chatClis : [setup.cliId]), [only, chatClis, setup.cliId])
  const [favorites, setFavorites] = useState(readFavorites)
  const [tab, setTab] = useState(setup.cliId)
  const [query, setQuery] = useState('')
  const [more, setMore] = useState(false)
  const onFavorites = tab === FAVORITES
  const catalog = onFavorites ? undefined : catalogs[tab]
  const current = catalogs[setup.cliId]
  const currentModel = current && current !== 'loading' ? current.models.find((m) => m.id === setup.model) : undefined
  const efforts = currentModel?.efforts ?? []

  // A CLI's models are asked for only when its tab is opened; the chat's own for the effort column.
  useEffect(() => {
    if (!onFavorites) void loadCatalog(tab)
  }, [tab, onFavorites, loadCatalog])
  useEffect(() => {
    void loadCatalog(setup.cliId)
  }, [setup.cliId, loadCatalog])

  const models: Array<{ cliId: string; model: ChatModel }> = useMemo(() => {
    if (onFavorites) {
      return favorites
        .filter((f) => clis.includes(f.cliId))
        .map((f) => {
          const known = catalogs[f.cliId]
          const m = known && known !== 'loading' ? known.models.find((x) => x.id === f.id) : undefined
          return { cliId: f.cliId, model: m ?? { id: f.id, label: f.label } }
        })
    }
    return catalog && catalog !== 'loading' ? catalog.models.map((m) => ({ cliId: tab, model: m })) : []
  }, [onFavorites, favorites, clis, catalogs, catalog, tab])

  const q = query.trim().toLowerCase()
  const found = useMemo(() => (q ? models.filter((m) => matches(m.model, q)) : models), [models, q])
  const visible = q || more ? found.slice(0, MAX_VISIBLE_MODELS) : found.slice(0, SHOWN_BEFORE_MORE)

  const isFavorite = (c: string, id: string): boolean => favorites.some((f) => f.cliId === c && f.id === id)
  const toggleFavorite = (c: string, m: ChatModel): void => {
    const next = isFavorite(c, m.id) ? favorites.filter((f) => !(f.cliId === c && f.id === m.id)) : [...favorites, { cliId: c, id: m.id, label: m.label }]
    setFavorites(next)
    saveFavorites(next)
  }

  const pick = (c: string, m: ChatModel): void => {
    // The effort carries over when the new model has it; fast only where the model runs fast.
    onChange({
      ...(c !== setup.cliId ? { cliId: c } : {}),
      model: m.id,
      effort: m.efforts?.includes(setup.effort) ? setup.effort : '',
      ...(setup.fast && !m.fast ? { fast: false } : {})
    })
  }

  // Ctrl+1…9 picks the model shown at that place.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || !/^[1-9]$/.test(event.key)) return
    const hit = visible[Number(event.key) - 1]
    if (!hit) return
    event.preventDefault()
    pick(hit.cliId, hit.model)
  }

  return (
    <div className={styles.body} onKeyDown={onKeyDown}>
      <div className={styles.columns}>
        <div className={styles.rail} role="tablist" aria-label="CLIs" aria-orientation="vertical">
          <button type="button" role="tab" aria-selected={onFavorites} className={cx(styles.railTab, onFavorites && styles.railActive)} onClick={() => setTab(FAVORITES)} title="Starred models">
            <Star aria-hidden className={styles.star} />
          </button>
          <span className={styles.railRule} aria-hidden />
          {clis.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={id === tab} aria-label={cliName(id)} className={cx(styles.railTab, id === tab && styles.railActive)} onClick={() => setTab(id)} title={cliName(id)}>
              <CliLogo cliId={id} size="sm" />
            </button>
          ))}
        </div>

        <div className={styles.models}>
          <div className={styles.search}>
            <Search aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={onFavorites ? 'Search starred models…' : `Search ${cliName(tab)} models…`}
              aria-label="Search models"
            />
            {!onFavorites && <IconButton label="Refresh models" icon={<RefreshCw />} onClick={() => void loadCatalog(tab, true)} />}
          </div>
          {!onFavorites && tab !== setup.cliId && started && <p className={styles.note}>{cliName(tab)} takes the conversation over from here, with what was said so far.</p>}
          {catalog && catalog !== 'loading' && catalog.error && <p className={styles.note}>{catalog.error} The default model still works.</p>}
          <div className={styles.list} role="listbox" aria-label={onFavorites ? 'Starred models' : `${cliName(tab)} models`}>
            {!onFavorites && (catalog === 'loading' || !catalog) && <p className={styles.note}>Loading models…</p>}
            {onFavorites && models.length === 0 && <p className={styles.note}>Star a model to keep it here, across CLIs.</p>}
            {visible.map(({ cliId: c, model: m }, i) => {
              const selected = c === setup.cliId && m.id === setup.model
              const starred = isFavorite(c, m.id)
              return (
                <div key={`${c}/${m.id || 'default'}`} className={cx(styles.option, selected && styles.selected)}>
                  <button type="button" role="option" aria-selected={selected} className={styles.optionMain} onClick={() => pick(c, m)} title={m.description ?? m.id}>
                    {onFavorites && <CliLogo cliId={c} size="sm" />}
                    <span className={styles.optionLabel}>{m.label}</span>
                    {m.group && !onFavorites && <span className={styles.optionGroup}>{m.group}</span>}
                    {selected && <Check aria-hidden className={styles.check} />}
                    <span className={styles.flex} />
                    {i < 9 && <kbd className={styles.keys}>Ctrl+{i + 1}</kbd>}
                  </button>
                  <button type="button" className={cx(styles.starButton, starred && styles.starred)} aria-pressed={starred} aria-label={starred ? `Unstar ${m.label}` : `Star ${m.label}`} onClick={() => toggleFavorite(c, m)}>
                    <Star aria-hidden />
                  </button>
                </div>
              )
            })}
            {!q && !more && found.length > SHOWN_BEFORE_MORE && (
              <button type="button" className={styles.more} onClick={() => setMore(true)}>
                Show {found.length - SHOWN_BEFORE_MORE} more
              </button>
            )}
            {q && found.length === 0 && models.length > 0 && <p className={styles.note}>No models match “{query}”.</p>}
            {found.length > MAX_VISIBLE_MODELS && (q || more) && <p className={styles.note}>Showing {MAX_VISIBLE_MODELS} of {found.length}. Refine the search.</p>}
          </div>
        </div>

        <div className={styles.effort} role="radiogroup" aria-label="Reasoning effort">
          <div className={styles.effortHead}>
            <span>Reasoning</span>
            <span className={styles.effortModel}>{currentModel?.label ?? 'Default model'}</span>
          </div>
          {efforts.length === 0 ? (
            <p className={styles.note}>This model has no effort setting.</p>
          ) : (
            [{ id: '', label: `Default${currentModel?.defaultEffort ? ` (${currentModel.defaultEffort})` : ''}` }, ...efforts.map((e) => ({ id: e, label: capitalize(e) }))].map((e) => {
              const on = setup.effort === e.id
              return (
                <button key={e.id || 'default'} type="button" role="radio" aria-checked={on} className={cx(styles.effortOption, on && styles.selected)} onClick={() => onChange({ effort: e.id })}>
                  <EffortIcon level={e.id || currentModel?.defaultEffort} levels={efforts} />
                  <span className={styles.flex}>{e.label}</span>
                  {on && <Check aria-hidden className={styles.check} />}
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className={styles.footer}>
        {currentModel?.fast && (
          <Tabs
            label="Speed"
            variant="segmented"
            value={setup.fast ? 'fast' : 'standard'}
            onChange={(v) => onChange({ fast: v === 'fast' })}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'fast', label: 'Fast', icon: <Zap /> }
            ]}
          />
        )}
        {current && current !== 'loading' && current.plan && (
          <button type="button" className={cx(styles.toggle, setup.plan && styles.toggleOn)} aria-pressed={setup.plan} onClick={() => onChange({ plan: !setup.plan })} title="The agent plans and answers without changing anything">
            <ListTodo aria-hidden /> Plan mode
          </button>
        )}
        <span className={styles.flex} />
        <Tabs
          label="What the agent may do"
          variant="segmented"
          value={accessOf(setup, Boolean(current && current !== 'loading' && current.prompts))}
          onChange={(v) => onChange({ autoApprove: v === 'full', ask: v === 'ask' })}
          options={(['read', ...(current && current !== 'loading' && current.prompts ? (['ask'] as const) : []), 'full'] as const).map((value) => {
            const { label, icon: Icon } = ACCESS[value]
            return { value, label, icon: <Icon /> }
          })}
        />
      </div>
    </div>
  )
}

