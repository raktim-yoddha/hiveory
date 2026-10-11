import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import { connectionFor, optionInputs, type McpOption, type McpSearchResult, type StoreMcpServer } from '@shared/domain'
import { Button, IconButton } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { Tabs } from '../../../components/ui/Tabs'
import { TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { useConnections } from '../../../stores/connections'
import { runAction, useNotices } from '../../../stores/notices'
import form from '../../../components/ui/form.module.css'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)
const RUNNER: Record<'npm' | 'pypi' | 'oci', string> = { npm: 'npx', pypi: 'uvx', oci: 'Docker' }
const optionLabel = (o: McpOption): string => (o.kind === 'remote' ? 'Hosted' : `${RUNNER[o.registry]} · ${o.identifier}`)
const titleOf = (s: StoreMcpServer): string => s.title || s.name.split('/').at(-1) || s.name

/**
 * The official MCP Registry in the MCP tab (ADR 0041): search it, then add a server to Hiveory, which
 * runs it for every agent — terminal, chat and bots — like any server added by hand.
 */
export function McpStore({ lead }: { lead: ReactNode }) {
  const connections = useConnections((s) => s.connections)
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [page, setPage] = useState<{ query: string; result: McpSearchResult } | null>(null)
  const [more, setMore] = useState(false)
  const [adding, setAdding] = useState<StoreMcpServer | null>(null)
  const added = new Set(connections.map((c) => c.name.toLowerCase()))

  // The registry's search takes seconds, so it runs on Enter (and lists the newest servers first).
  useEffect(() => {
    let live = true
    void api('store.searchMcp', { query: submitted })
      .then((result) => live && setPage({ query: submitted, result }))
      .catch(() => live && setPage({ query: submitted, result: { servers: [] } }))
    return () => {
      live = false
    }
  }, [submitted])

  const loadMore = (): void => {
    if (!page?.result.next) return
    setMore(true)
    void api('store.searchMcp', { query: page.query, cursor: page.result.next })
      .then((next) => setPage((p) => p && { query: p.query, result: { servers: [...p.result.servers, ...next.servers], next: next.next } }))
      .catch(() => undefined)
      .finally(() => setMore(false))
  }

  const loading = !page || page.query !== submitted
  return (
    <>
      <form
        className={styles.toolbar}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setSubmitted(query.trim())
        }}
      >
        {lead}
        <div className={styles.search}>
          <TextInput type="search" value={query} onChange={setQuery} placeholder="Search the MCP Registry — github, postgres, slack… then Enter" aria-label="Search the MCP Registry" autoFocus />
        </div>
        <Button size="sm" type="submit" loading={loading && Boolean(submitted)}>
          Search
        </Button>
      </form>
      <div className={settings.group}>
        <p className={cx(settings.groupNote, styles.noteTop)}>
          The official MCP Registry. Adding a server runs it for every agent; packages run on this computer with npx, uvx or Docker.
        </p>
        {loading ? (
          <p className={settings.empty}>{submitted ? 'Searching the MCP Registry (it can take a few seconds)…' : 'Loading the MCP Registry…'}</p>
        ) : page.result.servers.length === 0 ? (
          <p className={settings.empty}>No servers match.</p>
        ) : (
          <ul className={settings.list}>
            {page.result.servers.map((server, index) => {
              const isAdded = added.has(titleOf(server).slice(0, 40).toLowerCase())
              return (
                <li key={`${server.name}@${server.version}`} className={cx(settings.listItem, styles.stagger)} style={{ '--i': index % 30 } as CSSProperties}>
                  <div className={settings.listMain}>
                    <span className={styles.skillName}>
                      <span className={settings.listTitle}>{titleOf(server)}</span>
                      <span className={styles.badge}>{server.options.map((o) => (o.kind === 'remote' ? 'Hosted' : RUNNER[o.registry])).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</span>
                      {isAdded && <span className={styles.badge}>Added</span>}
                    </span>
                    <span className={styles.description} title={server.description}>
                      {server.description || server.name} · v{server.version}
                    </span>
                  </div>
                  {server.repository && <IconButton label={`Open ${titleOf(server)}'s repository`} icon={<ExternalLink />} onClick={() => openUrl(server.repository!)} />}
                  <Button size="sm" icon={<Plus />} disabled={isAdded} onClick={() => setAdding(server)}>
                    {isAdded ? 'Added' : 'Add'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {!loading && page.result.next && (
          <div className={styles.moreRow}>
            <Button size="sm" variant="ghost" loading={more} onClick={loadMore}>
              Show more
            </Button>
          </div>
        )}
      </div>
      {adding && <AddServerDialog server={adding} onClose={() => setAdding(null)} />}
    </>
  )
}

function AddServerDialog({ server, onClose }: { server: StoreMcpServer; onClose: () => void }) {
  const put = useConnections((s) => s.put)
  const [index, setIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const option = server.options[index]!
  const inputs = optionInputs(option)
  const spec = connectionFor(server, option, values)

  const add = (): void => {
    if (typeof spec === 'string') return
    setBusy(true)
    void runAction(`Add ${titleOf(server)}`, async () => {
      put(await api('connections.saveCustom', spec))
      useNotices.getState().push({ level: 'info', message: `${titleOf(server)} added: every agent can use it now.` })
      onClose()
    }).finally(() => setBusy(false))
  }

  return (
    <Modal
      open
      title={`Add ${titleOf(server)}`}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Plus />} loading={busy} disabled={typeof spec === 'string'} title={typeof spec === 'string' ? spec : undefined} onClick={add}>
            Add to every agent
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.hint}>{server.description}</p>
        {server.options.length > 1 && (
          <Tabs<string>
            label="How it runs"
            variant="segmented"
            value={String(index)}
            onChange={(v) => setIndex(Number(v))}
            options={server.options.map((o, i) => ({ value: String(i), label: optionLabel(o) }))}
          />
        )}
        <p className={styles.mono}>{typeof spec === 'string' ? optionLabel(option) : spec.url ?? [spec.command, ...(spec.args ?? [])].join(' ')}</p>
        {inputs.map((input) => (
          <label key={input.name} className={form.field}>
            <span className={form.fieldLabel}>
              {input.name}
              {input.required ? ' *' : ''}
            </span>
            {input.choices ? (
              <Select
                label={input.name}
                hideLabel
                value={values[input.name] ?? input.default ?? ''}
                options={[{ value: '', label: 'Choose…', disabled: true }, ...input.choices.map((c) => ({ value: c, label: c }))]}
                onChange={(v) => setValues((s) => ({ ...s, [input.name]: v }))}
              />
            ) : (
              <TextInput
                type={input.secret ? 'password' : 'text'}
                value={values[input.name] ?? ''}
                placeholder={input.default ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [input.name]: v }))}
              />
            )}
            {input.description && <span className={styles.hint}>{input.description}</span>}
          </label>
        ))}
        {inputs.length === 0 && <p className={styles.hint}>Nothing to fill in.</p>}
      </div>
    </Modal>
  )
}
