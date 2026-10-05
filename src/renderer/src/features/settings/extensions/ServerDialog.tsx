import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ConnectionView } from '@shared/domain'
import { Button, IconButton } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Tabs } from '../../../components/ui/Tabs'
import { TextField, TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { useConnections } from '../../../stores/connections'
import { runAction } from '../../../stores/notices'
import form from '../../../components/ui/form.module.css'
import styles from './Extensions.module.css'

interface Pair {
  key: string
  value: string
  /** Already stored in main; an empty value keeps it. */
  saved: boolean
}

/** Splits a command line into arguments, keeping "quoted parts" together. */
export const splitArgs = (line: string): string[] =>
  [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')


interface Props {
  open: boolean
  /** null: add a new server. */
  server: ConnectionView | null
  onClose: () => void
}

/** Adds or edits an MCP server Hiveory runs for every agent: a command (stdio) or a URL (HTTP). Values are write-only. */
export function ServerDialog({ open, server, onClose }: Props) {
  const put = useConnections((s) => s.put)
  const [name, setName] = useState(server?.name ?? '')
  const [transport, setTransport] = useState<'stdio' | 'http'>(server?.transport ?? 'stdio')
  const [command, setCommand] = useState(server?.transport === 'stdio' ? server.target : '')
  const [url, setUrl] = useState(server?.transport === 'http' ? server.target : '')
  const [pairs, setPairs] = useState<Pair[]>(() =>
    (server ? (server.transport === 'stdio' ? server.envKeys : server.headerKeys) : []).map((key) => ({ key, value: '', saved: true }))
  )
  const [busy, setBusy] = useState(false)

  const pairLabel = transport === 'stdio' ? 'Environment variables' : 'Headers'
  const editPair = (index: number, patch: Partial<Pair>): void => setPairs((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)))

  const save = (): void => {
    const [cmd, ...args] = splitArgs(command)
    const record = Object.fromEntries(pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value]))
    setBusy(true)
    void runAction(server ? 'Save server' : 'Add server', async () => {
      const view = await api('connections.saveCustom', {
        ...(server ? { id: server.id } : {}),
        name,
        transport,
        ...(transport === 'stdio' ? { command: cmd ?? '', args } : { url }),
        env: transport === 'stdio' ? record : {},
        headers: transport === 'http' ? record : {}
      })
      put(view)
      onClose()
    }).finally(() => setBusy(false))
  }

  return (
    <Modal
      open={open}
      title={server ? `Edit ${server.name}` : 'Add MCP server'}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || (transport === 'stdio' ? !command.trim() : !url.trim())} onClick={save}>
            {server ? 'Save and reconnect' : 'Add and connect'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.formRow}>
          <TextField label="Name" value={name} onChange={setName} placeholder="docs" autoFocus maxLength={40} />
          <div className={form.field}>
            <span className={styles.fieldTitle}>Runs as</span>
            <Tabs<'stdio' | 'http'>
              label="Transport"
              variant="segmented"
              value={transport}
              onChange={setTransport}
              options={[
                { value: 'stdio', label: 'Command' },
                { value: 'http', label: 'URL' }
              ]}
            />
          </div>
        </div>
        {transport === 'stdio' ? (
          <TextField label="Command" value={command} onChange={setCommand} placeholder="npx -y @scope/mcp-server --flag" />
        ) : (
          <TextField label="Server URL" value={url} onChange={setUrl} placeholder="https://example.com/mcp" />
        )}
        <div className={form.field}>
          <span className={styles.fieldTitle}>{pairLabel}</span>
          <div className={styles.pairs}>
            {pairs.map((pair, index) => (
              <div key={index} className={styles.pair}>
                <TextInput
                  value={pair.key}
                  onChange={(key) => editPair(index, { key, saved: false })}
                  placeholder={transport === 'stdio' ? 'API_KEY' : 'Authorization'}
                  aria-label={`${pairLabel} name`}
                />
                <TextInput
                  type="password"
                  value={pair.value}
                  onChange={(value) => editPair(index, { value })}
                  placeholder={pair.saved ? '•••••• saved — leave empty to keep' : 'Value'}
                  aria-label={`${pair.key || 'Entry'} value`}
                />
                <IconButton label={`Remove ${pair.key || 'entry'}`} icon={<X />} onClick={() => setPairs((list) => list.filter((_, i) => i !== index))} />
              </div>
            ))}
          </div>
          <span>
            <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setPairs((list) => [...list, { key: '', value: '', saved: false }])}>
              Add {transport === 'stdio' ? 'variable' : 'header'}
            </Button>
          </span>
          <span className={styles.hint}>Values are encrypted on this computer and never shown again. Put keys here, not in the command.</span>
        </div>
      </div>
    </Modal>
  )
}
