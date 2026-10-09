import { useEffect } from 'react'
import type { ChatChoice, Project } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { Select } from '../../components/ui/Select'
import { useChat } from '../../stores/chat'
import { useClis, useProjects } from '../../stores/data'
import styles from './ProjectScreen.module.css'

/**
 * The model and effort each chat CLI starts with when an agent opens in chat view here (ADR 0037).
 * Agents already open keep theirs; each can still change its own from its composer.
 */
export function ChatDefaults({ project }: { project: Project }) {
  const chatClis = useChat((s) => s.clis)
  const loadClis = useChat((s) => s.loadClis)
  const catalogs = useChat((s) => s.catalogs)
  const loadCatalog = useChat((s) => s.loadCatalog)
  const clis = useClis((s) => s.clis)
  const update = useProjects((s) => s.update)
  const defaults = project.settings?.chatDefaults ?? {}

  useEffect(() => {
    if (!chatClis.length) void loadClis()
  }, [chatClis.length, loadClis])
  useEffect(() => {
    for (const id of chatClis) void loadCatalog(id)
  }, [chatClis, loadCatalog])

  const save = (cliId: string, choice: ChatChoice): void => {
    const next = { ...defaults, [cliId]: choice }
    if (!choice.model && !choice.effort) delete next[cliId]
    void update(project.id, { settings: { chatDefaults: Object.keys(next).length ? next : null } })
  }

  if (!chatClis.length) return <p className={styles.muted}>No chat-capable CLI is installed.</p>

  return (
    <ul className={styles.chatDefaults}>
      {chatClis.map((cliId) => {
        const catalog = catalogs[cliId]
        const models = catalog && catalog !== 'loading' ? catalog.models : []
        const choice = defaults[cliId] ?? { model: '', effort: '' }
        const model = models.find((m) => m.id === choice.model)
        const efforts = model?.efforts ?? []
        const name = clis.find((c) => c.id === cliId)?.displayName ?? cliId
        return (
          <li key={cliId} className={styles.chatDefault}>
            <span className={styles.chatDefaultName}>
              <CliLogo cliId={cliId} size="sm" />
              {name}
            </span>
            <Select
              label={`${name} model`}
              hideLabel
              size="sm"
              value={choice.model}
              options={
                catalog === 'loading' || !catalog
                  ? [{ value: choice.model, label: 'Loading models…' }]
                  : models.map((m) => ({ value: m.id, label: m.label, group: m.group }))
              }
              onChange={(next) => {
                const nextEfforts = models.find((m) => m.id === next)?.efforts ?? []
                save(cliId, { model: next, effort: nextEfforts.includes(choice.effort) ? choice.effort : '' })
              }}
            />
            {efforts.length > 0 ? (
              <Select
                label={`${name} reasoning effort`}
                hideLabel
                size="sm"
                value={choice.effort}
                options={[
                  { value: '', label: `Default effort${model?.defaultEffort ? ` (${model.defaultEffort})` : ''}` },
                  ...efforts.map((e) => ({ value: e, label: e[0]!.toUpperCase() + e.slice(1) }))
                ]}
                onChange={(effort) => save(cliId, { model: choice.model, effort })}
              />
            ) : (
              <span />
            )}
          </li>
        )
      })}
    </ul>
  )
}
