import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Globe, MessageSquare, Play, Plus, Search } from 'lucide-react'
import type { CliDescriptor, WorkspaceScript } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { IconButton } from '../../components/ui/Button'
import { Popover } from '../../components/ui/Popover'
import { useHostClis, useProjects } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { openBrowserPane } from '../browser/open-browser'
import { agentActions } from './agent-actions'
import { runScript } from './run-script'
import { useChatUi } from './useChatUi'
import styles from './AddAgentMenu.module.css'

interface AddAgentMenuProps {
  workspaceId: string
  /** A pane of the area the new pane opens in, as a tab (ADR 0042). */
  paneId: string
}

/**
 * An area's "+": a new tab in that area (ADR 0042) — the browser, a Chat UI (ADR 0059: a chat whose CLI
 * and model are picked, and changed, in its own message box), a terminal (PowerShell, Command Prompt,
 * Git Bash) or a detected agent CLI in its terminal — with search. Nothing is hardcoded: entries come
 * from the CLI registry.
 */
export function AddAgentMenu({ workspaceId, paneId }: AddAgentMenuProps) {
  return (
    <Popover label="Add pane" align="end" trigger={(props) => <IconButton {...props} label="Add agent" icon={<Plus />} />}>
      {(close) => <AddPanePicker workspaceId={workspaceId} paneId={paneId} onDone={close} />}
    </Popover>
  )
}

function AddPanePicker({ workspaceId, paneId, onDone }: AddAgentMenuProps & { onDone: () => void }) {
  const projectId = useNavigation((s) => selectedProjectId(s.view))
  const { clis, loaded, load } = useHostClis(projectId)
  const openChat = useChatUi(workspaceId, projectId)
  const scripts = useProjects((s) => s.projects.find((p) => p.id === projectId)?.settings?.scripts)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchId = useId()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const shown = clis.filter((c) => c.available && (!q || c.displayName.toLowerCase().includes(q)))
    return [
      { label: 'Terminals', items: shown.filter((c) => c.kind === 'shell') },
      { label: 'Agents', items: shown.filter((c) => c.kind !== 'shell') }
    ].filter((g) => g.items.length)
  }, [clis, query])

  const open = (cli: CliDescriptor): void => {
    onDone()
    const placement = { targetPaneId: paneId, side: 'right' as const, asTab: true }
    // A CLI from the list always gets its terminal; Chat UI is its own entry (ADR 0059).
    void agentActions.open(workspaceId, cli.id, placement, undefined, false)
  }

  const chatUi = (): void => {
    if (!openChat) return
    onDone()
    openChat({ targetPaneId: paneId, side: 'right', asTab: true })
  }
  const showChat = Boolean(openChat) && (!query.trim() || 'chat ui'.includes(query.trim().toLowerCase()))

  // The Workspace's scripts (ADR 0061), each in a new terminal tab here.
  const shownScripts = (scripts ?? []).filter((s) => !query.trim() || `${s.name} ${s.command}`.toLowerCase().includes(query.trim().toLowerCase()))
  const script = (s: WorkspaceScript): void => {
    if (!projectId) return
    onDone()
    void runScript(workspaceId, projectId, s, { targetPaneId: paneId, side: 'right', asTab: true })
  }

  const browser = (): void => {
    onDone()
    void openBrowserPane(workspaceId, { beside: { paneId, side: 'tab' } })
  }
  const showBrowser = !query.trim() || 'browser'.includes(query.trim().toLowerCase())

  const items = (): HTMLButtonElement[] => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  const onListKey = (event: KeyboardEvent): void => {
    const all = items()
    const index = all.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') all[Math.min(index + 1, all.length - 1)]?.focus()
    else if (event.key === 'ArrowUp') (index <= 0 ? searchRef.current : all[index - 1])?.focus()
    else return
    event.preventDefault()
  }

  return (
    <div className={styles.picker}>
      <label className={styles.search} htmlFor={searchId}>
        <Search aria-hidden />
        <input
          ref={searchRef}
          id={searchId}
          autoFocus
          value={query}
          placeholder="Search terminals and agents"
          aria-label="Search terminals and agents"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              items()[0]?.focus()
            } else if (e.key === 'Enter') {
              // Otherwise the same Enter lands on the "+" button once focus returns to it and reopens the picker.
              e.preventDefault()
              const first = groups[0]?.items[0]
              if (first) open(first)
              else if (showChat) chatUi()
            }
          }}
        />
      </label>
      <div ref={listRef} className={styles.list} role="menu" aria-label="Open" onKeyDown={onListKey}>
        {showBrowser && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>Browser</div>
            <button type="button" role="menuitem" className={styles.item} onClick={browser}>
              <Globe aria-hidden className={styles.itemIcon} />
              <span>Browser</span>
            </button>
          </div>
        )}
        {showChat && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>Chat</div>
            <button type="button" role="menuitem" className={styles.item} onClick={chatUi} title="A chat: pick and change its CLI and model in the message box">
              <MessageSquare aria-hidden className={styles.itemIcon} />
              <span>Chat UI</span>
            </button>
          </div>
        )}
        {shownScripts.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>Scripts</div>
            {shownScripts.map((s) => (
              <button key={s.name} type="button" role="menuitem" className={styles.item} onClick={() => script(s)} title={s.command}>
                <Play aria-hidden className={styles.itemIcon} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        )}
        {groups.length === 0 && !showBrowser && !showChat && !shownScripts.length && <p className={styles.empty}>{query ? 'No matches' : 'No CLIs detected'}</p>}
        {groups.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.groupLabel}>{group.label}</div>
            {group.items.map((cli) => (
              <button key={cli.id} type="button" role="menuitem" className={styles.item} onClick={() => open(cli)}>
                <CliLogo cliId={cli.id} size="sm" />
                <span>{cli.displayName}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
