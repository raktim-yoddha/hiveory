import { Bot, Code2, MessageSquare, PanelLeft, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { agenticSuperAppClient, type ApplicationMode } from './api/agentic-super-app-client'

type ModeDefinition = { mode: ApplicationMode; label: string; description: string; icon: typeof Bot; navigation: string[] }

const modeDefinitions: ModeDefinition[] = [
  { mode: 'agent', label: 'Agent', description: 'Autonomous workspaces, reviews, and approvals will appear here.', icon: Bot, navigation: ['Runs', 'Profiles', 'Skills'] },
  { mode: 'code', label: 'Code', description: 'Projects, editor surfaces, and terminal orchestration will appear here.', icon: Code2, navigation: ['Projects', 'Changes', 'Sessions'] },
  { mode: 'chat', label: 'Chat', description: 'Focused conversations and artifacts will appear here.', icon: MessageSquare, navigation: ['Conversations', 'Artifacts', 'Archive'] },
]

export function AgenticSuperAppShell() {
  const [activeMode, setActiveMode] = useState<ApplicationMode>('agent')
  const [connected, setConnected] = useState(false)
  const definition = useMemo(() => modeDefinitions.find((item) => item.mode === activeMode)!, [activeMode])

  useEffect(() => {
    void agenticSuperAppClient.bootstrap().then((snapshot) => {
      setActiveMode(snapshot.active_mode)
      setConnected(true)
    }).catch(() => setConnected(false))
  }, [])

  const selectMode = (mode: ApplicationMode) => {
    setActiveMode(mode)
    void agenticSuperAppClient.setActiveMode(mode).then((snapshot) => setActiveMode(snapshot.active_mode)).catch(() => undefined)
  }

  const ModeIcon = definition.icon
  return <main className="agentic-super-app-shell">
    <header className="agentic-super-app-titlebar">
      <div className="agentic-super-app-brand"><PanelLeft size={16} aria-hidden="true" /> <span>Agentic Super App</span></div>
      <nav className="agentic-super-app-mode-switch" aria-label="Workspace mode">
        {modeDefinitions.map(({ mode, label, icon: Icon }) => <button key={mode} className={mode === activeMode ? 'is-active' : ''} onClick={() => selectMode(mode)} aria-pressed={mode === activeMode}>
          <Icon size={15} aria-hidden="true" />{label}
        </button>)}
      </nav>
      <div className="agentic-super-app-connection" aria-label={connected ? 'Connected to local host' : 'Preview mode'}><ShieldCheck size={15} aria-hidden="true" />{connected ? 'Local host' : 'Preview'}</div>
    </header>
    <section className="agentic-super-app-workspace">
      <aside className="agentic-super-app-rail" aria-label={`${definition.label} navigation`}>
        <div className="agentic-super-app-rail-heading">{definition.label}</div>
        {definition.navigation.map((item) => <button key={item}>{item}</button>)}
        <div className="agentic-super-app-rail-footer">Phase 0–1 foundation</div>
      </aside>
      <section className="agentic-super-app-content" aria-labelledby="agentic-super-app-page-title">
        <div className="agentic-super-app-content-header"><ModeIcon size={22} aria-hidden="true" /><div><p className="agentic-super-app-eyebrow">{definition.label} workspace</p><h1 id="agentic-super-app-page-title">Ready for the next layer</h1></div></div>
        <p className="agentic-super-app-description">{definition.description}</p>
        <div className="agentic-super-app-empty-state"><div className="agentic-super-app-empty-mark"><ModeIcon size={28} aria-hidden="true" /></div><h2>Foundation complete</h2><p>The local shell, contracts, and security boundaries are in place. Product capabilities are introduced in later phases.</p></div>
      </section>
    </section>
  </main>
}
