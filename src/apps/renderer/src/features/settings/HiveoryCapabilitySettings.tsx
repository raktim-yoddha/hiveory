import {
  ArrowLeft,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  Cpu,
  FolderPlus,
  GitBranch,
  Globe2,
  Link2,
  ListChecks,
  MonitorCog,
  Network,
  PanelTop,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  hiveoryClient,
  type CodeAdapterSummary,
  type CodeSnapshot,
  type PluginCatalogEntry,
  type PluginConnectionSummary,
} from '../../shared/api/hiveory-client'
import { loadYoloPreferences, saveYoloPreferences, supportsYoloLaunch } from '../workspace/model/code-yolo-preferences'

type SettingsSection = 'onboarding' | 'agents' | 'orchestration' | 'computer-use' | 'browser-use' | 'general' | 'unavailable'
type OnboardingStep = 'notifications' | 'agent' | 'cli' | 'integrations' | 'setup' | 'projects' | 'multi-task' | 'browser'
type CapabilityPreferences = {
  defaultAdapterId: string | null
  runtime: 'windows' | 'wsl'
  agentStatusHooks: boolean
  autoTabTitles: boolean
  computerAwake: 'on' | 'agent' | 'off'
  cacheTimer: boolean
  permissionMode: 'manual' | 'yolo'
  nestedWorkerDepth: number
  notificationsConfirmed: boolean
  setupProjectId: string | null
  setupCommand: string
  browserUseEnabled: boolean
  browserTarget: 'inner' | 'external' | 'desktop'
  browserDefaultUrl: string
}

const storageKey = 'hiveory.capability-settings.v1'
const defaultPreferences: CapabilityPreferences = {
  defaultAdapterId: null,
  runtime: 'windows',
  agentStatusHooks: true,
  autoTabTitles: true,
  computerAwake: 'agent',
  cacheTimer: false,
  permissionMode: 'manual',
  nestedWorkerDepth: 1,
  notificationsConfirmed: false,
  setupProjectId: null,
  setupCommand: '',
  browserUseEnabled: false,
  browserTarget: 'inner',
  browserDefaultUrl: 'https://www.google.com/',
}

const orchestrationSkill = `---
id: hiveory-orchestration
name: Hiveory Orchestration
version: 1.0.0
description: Coordinate bounded work through Hiveory's durable orchestration runs, worker dispatches, mailbox, and decision gates.
triggers: [orchestration, coordinate, worker]
permissions: [workspace.read, workspace.execute]
---

# Hiveory Orchestration

Use Hiveory Code > Coordination to create bounded runs, draft or review tasks, dispatch workers, and handle decision gates. Keep every task independently verifiable. Use the durable mailbox for handoffs and status updates.`

const computerUseSkill = `---
id: hiveory-computer-use
name: Hiveory Computer Use
version: 1.1.0
description: Use Hiveory's embedded browser, external browsers, and user-authorized desktop through inspectable tools.
triggers: [browser, desktop, computer]
permissions: [browser.navigate, browser.interact, workspace.read, computer.snapshot, computer.action, computer.run]
---

# Hiveory Computer Use

Use the browser.* tools for the embedded Hiveory Browser. Start with browser.state, then browser.navigate, browser.click, browser.fill, browser.press, browser.scroll, and browser.capture as needed. The browser_id and workspace_id come from the active workspace context.

Use browser.open_external or browser.open_external_url when the user explicitly asks for a page in another browser. For user-authorized desktop work, use computer.capabilities, computer.list_apps, computer.list_windows, computer.snapshot, and computer.action; use computer.run only for an explicit shell command. Never hide an external side effect: describe the target and action and follow the Agent approval policy before executing it.`

const browserUseSkill = `---
id: hiveory-browser-use
name: Hiveory Browser Use
version: 1.1.0
description: Drive the embedded Hiveory Browser, external browsers, and the user's Windows desktop with explicit user authorization.
triggers: [browser, web, website, desktop, computer]
permissions: [browser.navigate, browser.interact, browser.capture, computer.snapshot, computer.action]
---

# Hiveory Browser Use

For pages inside Hiveory, use browser.state and browser.snapshot before acting, then use the browser.* tools with the active browser_id. Use browser.open to reconnect a pane, browser.navigate for a URL, browser.click/fill/press for page actions, browser.scroll for movement, and browser.capture when the user needs a screenshot checkpoint. Use browser.open_external or browser.open_external_url only when the user requests another browser. For desktop-wide actions, discover the target with computer.list_apps and computer.snapshot, then use computer.action with the configured approval policy. Use computer.run only for an explicit shell command.`

function readPreferences(): CapabilityPreferences {
  if (typeof window === 'undefined') return defaultPreferences
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Partial<CapabilityPreferences>
    return {
      ...defaultPreferences,
      ...value,
      runtime: value.runtime === 'wsl' ? 'wsl' : 'windows',
      computerAwake: value.computerAwake === 'on' || value.computerAwake === 'off' ? value.computerAwake : 'agent',
      permissionMode: value.permissionMode === 'yolo' ? 'yolo' : 'manual',
      nestedWorkerDepth: Math.max(1, Math.min(4, Math.round(Number(value.nestedWorkerDepth) || 1))),
      browserUseEnabled: value.browserUseEnabled === true,
      browserTarget: value.browserTarget === 'external' || value.browserTarget === 'desktop' ? value.browserTarget : 'inner',
      browserDefaultUrl: typeof value.browserDefaultUrl === 'string' && value.browserDefaultUrl.trim() ? value.browserDefaultUrl : defaultPreferences.browserDefaultUrl,
    }
  } catch {
    return defaultPreferences
  }
}

function adapterLabel(adapter: CodeAdapterSummary): string {
  return adapter.display_name || adapter.executable
}

function placeholderCopy(label: string): { title: string; detail: string } {
  return {
    title: `${label} is not configured in this build`,
    detail: 'This category is intentionally unavailable until Hiveory exposes a durable service for it. The AI capabilities and onboarding areas above are live and connected to the desktop host.',
  }
}

export function HiveoryCapabilitySettings({
  onBackToApp,
  onOpenWorkbench,
  children,
}: {
  onBackToApp: () => void
  onOpenWorkbench: () => void
  children: ReactNode
}) {
  const [section, setSection] = useState<SettingsSection>('onboarding')
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('notifications')
  const [preferences, setPreferences] = useState<CapabilityPreferences>(readPreferences)
  const [snapshot, setSnapshot] = useState<CodeSnapshot | null>(null)
  const [plugins, setPlugins] = useState<PluginCatalogEntry[]>([])
  const [connections, setConnections] = useState<PluginConnectionSummary[]>([])
  const [installedSkillNames, setInstalledSkillNames] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setBusy('refresh')
    setError(null)
    try {
      const [nextSnapshot, nextPlugins, nextConnections, skills, browserUseSettings] = await Promise.all([
        hiveoryClient.codeSnapshot(),
        hiveoryClient.pluginCatalog(),
        hiveoryClient.pluginConnections(),
        hiveoryClient.agentSkills(),
        hiveoryClient.browserUseSettings(),
      ])
      setSnapshot(nextSnapshot)
      setPlugins(nextPlugins)
      setConnections(nextConnections)
      setInstalledSkillNames(skills.skills.map((skill) => skill.name.toLowerCase()))
      setPreferences((current) => ({
        ...current,
        browserUseEnabled: browserUseSettings.enabled,
        browserTarget: browserUseSettings.target,
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settings could not refresh from the desktop host.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* Local settings remain optional in browser preview. */ }
  }, [preferences])

  const adapters = snapshot?.adapters ?? []
  const detectedAdapters = adapters.filter((adapter) => adapter.detected)
  const connectedPluginIds = new Set(connections.filter((connection) => connection.validated_at_unix_ms !== null).map((connection) => connection.plugin_id))
  const filteredSections = useMemo(() => {
    const term = search.trim().toLowerCase()
    const rows: Array<{ id: SettingsSection; label: string; icon: typeof ListChecks }> = [
      { id: 'onboarding', label: 'Onboarding checklist', icon: ListChecks },
      { id: 'agents', label: 'Agents', icon: Bot },
      { id: 'orchestration', label: 'Orchestration', icon: Workflow },
      { id: 'computer-use', label: 'Computer Use', icon: MonitorCog },
      { id: 'browser-use', label: 'Browser Use', icon: Globe2 },
      { id: 'general', label: 'General', icon: SlidersHorizontal },
    ]
    return term ? rows.filter((row) => row.label.toLowerCase().includes(term)) : rows
  }, [search])

  const updatePreferences = (patch: Partial<CapabilityPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }))
    if (patch.browserUseEnabled === undefined && patch.browserTarget === undefined) return
    const nextEnabled = patch.browserUseEnabled ?? preferences.browserUseEnabled
    const nextTarget = patch.browserTarget ?? preferences.browserTarget
    void hiveoryClient.updateBrowserUseSettings({ enabled: nextEnabled, target: nextTarget }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Browser Use settings could not be saved to the desktop host.')
    })
  }
  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key)
    setNotice(null)
    setError(null)
    try {
      await action()
      setNotice(success)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The setting could not be updated.')
    } finally {
      setBusy(null)
    }
  }

  const installSkill = async (name: string, source: string) => {
    await run(`install-${name}`, async () => {
      if (!installedSkillNames.includes(name.toLowerCase())) await hiveoryClient.createAgentSkill(source)
      await refresh()
    }, `${name} is installed and available to Hiveory agents.`)
  }

  const selectDefaultAgent = (adapterId: string) => {
    updatePreferences({ defaultAdapterId: adapterId })
    setOnboardingStep('cli')
    setNotice(`${adapters.find((adapter) => adapter.id === adapterId)?.display_name ?? 'Agent'} is now the default coding agent.`)
  }

  const setPermissionMode = (permissionMode: CapabilityPreferences['permissionMode']) => {
    const yoloPreferences = loadYoloPreferences()
    for (const adapter of adapters) if (supportsYoloLaunch(adapter.id)) yoloPreferences[adapter.id] = permissionMode === 'yolo'
    saveYoloPreferences(yoloPreferences)
    updatePreferences({ permissionMode })
    setNotice(permissionMode === 'yolo' ? 'YOLO launch defaults are enabled for supported coding agents.' : 'Manual permission prompts are restored for supported coding agents.')
  }

  const addProject = () => {
    void run('add-project', async () => {
      const path = await hiveoryClient.chooseAttachmentFolderPath()
      if (!path) return
      await hiveoryClient.addCodeProject(path)
      await refresh()
    }, 'Project added to Hiveory and available in Workbench.')
  }

  const projectCount = snapshot?.projects.length ?? 0
  const workspaceCount = snapshot?.workspaces.length ?? 0
  const integrationsReady = connectedPluginIds.size > 0
  const orchestrationInstalled = installedSkillNames.includes('hiveory orchestration')
  const computerUseInstalled = installedSkillNames.includes('hiveory computer use')
  const browserUseInstalled = installedSkillNames.includes('hiveory browser use')
  const steps: Array<{ id: OnboardingStep; label: string; done: boolean }> = [
    { id: 'notifications', label: 'Turn on notifications', done: preferences.notificationsConfirmed },
    { id: 'agent', label: 'Choose your default agent', done: Boolean(preferences.defaultAdapterId) },
    { id: 'cli', label: 'Enable Hiveory CLI & skills', done: detectedAdapters.length > 0 && orchestrationInstalled && computerUseInstalled && browserUseInstalled },
    { id: 'integrations', label: 'Connect integrations', done: integrationsReady },
    { id: 'setup', label: 'Automate workspace setup', done: Boolean(preferences.setupProjectId && preferences.setupCommand.trim()) },
    { id: 'projects', label: 'Start work in multiple repos', done: projectCount > 0 },
    { id: 'multi-task', label: 'Multi-task', done: workspaceCount > 1 },
    { id: 'browser', label: 'Use Hiveory browser', done: preferences.browserUseEnabled && browserUseInstalled },
  ]
  const completedSetup = steps.slice(0, 6).filter((item) => item.done).length
  const visibleContent = section === 'onboarding'
    ? <OnboardingPanel
        adapters={adapters}
        detectedAdapters={detectedAdapters}
        plugins={plugins}
        connectedPluginIds={connectedPluginIds}
        snapshot={snapshot}
        preferences={preferences}
        steps={steps}
        selectedStep={onboardingStep}
        busy={busy}
        orchestrationInstalled={orchestrationInstalled}
        computerUseInstalled={computerUseInstalled}
        browserUseInstalled={browserUseInstalled}
        completedSetup={completedSetup}
        onSelectStep={setOnboardingStep}
        onConfirmNotifications={() => void run('notifications', async () => { await hiveoryClient.testNotification(); updatePreferences({ notificationsConfirmed: true }) }, 'A native test notification was sent.')}
        onSelectAgent={selectDefaultAgent}
        onInstallSkills={() => void Promise.all([installSkill('Hiveory Orchestration', orchestrationSkill), installSkill('Hiveory Computer Use', computerUseSkill), installSkill('Hiveory Browser Use', browserUseSkill)])}
        onRefresh={() => void refresh()}
        onOpenWorkbench={onOpenWorkbench}
        onAddProject={addProject}
        onSaveSetup={() => setNotice('Workspace setup is saved. Future trusted worktrees for this project will launch it in their first terminal pane.')}
        onUpdatePreferences={updatePreferences}
      />
    : section === 'agents'
      ? <AgentsPanel adapters={adapters} detectedAdapters={detectedAdapters} preferences={preferences} busy={busy} onSelect={selectDefaultAgent} onUpdate={updatePreferences} onPermissionMode={setPermissionMode} onRefresh={() => void refresh()} />
      : section === 'orchestration'
        ? <OrchestrationPanel installed={orchestrationInstalled} preferences={preferences} adapters={detectedAdapters} busy={busy} onInstall={() => void installSkill('Hiveory Orchestration', orchestrationSkill)} onRefresh={() => void refresh()} onUpdate={updatePreferences} onOpenWorkbench={onOpenWorkbench} />
        : section === 'computer-use'
          ? <ComputerUsePanel installed={computerUseInstalled} busy={busy} onInstall={() => void installSkill('Hiveory Computer Use', computerUseSkill)} onRefresh={() => void refresh()} onOpenWorkbench={onOpenWorkbench} />
          : section === 'browser-use'
            ? <BrowserUsePanel installed={browserUseInstalled} busy={busy} preferences={preferences} onInstall={() => void installSkill('Hiveory Browser Use', browserUseSkill)} onRefresh={() => void refresh()} onOpenWorkbench={onOpenWorkbench} onOpenExternal={(url) => void run('browser-external', async () => { await hiveoryClient.openExternalUrl({ url }) }, 'Opened the page in the default external browser.')} onUpdate={updatePreferences} />
          : section === 'general'
            ? children
            : <UnavailablePanel {...placeholderCopy('This settings category')} />

  return <div className="hiveory-capability-settings">
    <aside className="hiveory-capability-sidebar" aria-label="Settings navigation">
      <button type="button" className="hiveory-capability-back" onClick={onBackToApp}><ArrowLeft size={16} />Back to app</button>
      <label className="hiveory-capability-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings" aria-label="Search settings" /><kbd>Ctrl</kbd><kbd>F</kbd></label>
      <div className="hiveory-capability-nav">
        {filteredSections.filter((item) => item.id === 'onboarding').map((item) => <SettingsNavButton key={item.id} item={item} section={section} onSelect={setSection} />)}
        <p>AI capabilities</p>
        {filteredSections.filter((item) => ['agents', 'orchestration', 'computer-use', 'browser-use'].includes(item.id)).map((item) => <SettingsNavButton key={item.id} item={item} section={section} onSelect={setSection} />)}
        <button type="button" className="hiveory-capability-nav-placeholder" onClick={() => setSection('unavailable')}><Cpu size={16} />AI Provider Accounts <small>optional</small></button>
        <button type="button" className="hiveory-capability-nav-placeholder" onClick={() => setSection('unavailable')}><Sparkles size={16} />Voice</button>
        <p>Set up</p>
        <SettingsNavButton item={{ id: 'general', label: 'General', icon: SlidersHorizontal }} section={section} onSelect={setSection} />
        <button type="button" className="hiveory-capability-nav-placeholder" onClick={() => setSection('unavailable')}><Link2 size={16} />Integrations</button>
        <button type="button" className="hiveory-capability-nav-placeholder" onClick={() => setSection('unavailable')}><PanelTop size={16} />Appearance</button>
      </div>
    </aside>
    <main className="hiveory-capability-main">
      {notice && <div className="hiveory-capability-feedback" role="status"><CheckCircle2 size={15} />{notice}</div>}
      {error && <div className="hiveory-capability-feedback is-error" role="alert"><CircleAlert size={15} />{error}</div>}
      {visibleContent}
    </main>
  </div>
}

function SettingsNavButton({ item, section, onSelect }: { item: { id: SettingsSection; label: string; icon: typeof ListChecks }; section: SettingsSection; onSelect: (value: SettingsSection) => void }) {
  const Icon = item.icon
  return <button type="button" className={section === item.id ? 'is-selected' : ''} onClick={() => onSelect(item.id)}><Icon size={16} />{item.label}</button>
}

function OnboardingPanel({ adapters, detectedAdapters, plugins, connectedPluginIds, snapshot, preferences, steps, selectedStep, busy, orchestrationInstalled, computerUseInstalled, browserUseInstalled, completedSetup, onSelectStep, onConfirmNotifications, onSelectAgent, onInstallSkills, onRefresh, onOpenWorkbench, onAddProject, onSaveSetup, onUpdatePreferences }: {
  adapters: CodeAdapterSummary[]; detectedAdapters: CodeAdapterSummary[]; plugins: PluginCatalogEntry[]; connectedPluginIds: Set<string>; snapshot: CodeSnapshot | null; preferences: CapabilityPreferences; steps: Array<{ id: OnboardingStep; label: string; done: boolean }>; selectedStep: OnboardingStep; busy: string | null; orchestrationInstalled: boolean; computerUseInstalled: boolean; browserUseInstalled: boolean; completedSetup: number; onSelectStep: (value: OnboardingStep) => void; onConfirmNotifications: () => void; onSelectAgent: (adapterId: string) => void; onInstallSkills: () => void; onRefresh: () => void; onOpenWorkbench: () => void; onAddProject: () => void; onSaveSetup: () => void; onUpdatePreferences: (patch: Partial<CapabilityPreferences>) => void
}) {
  const current = steps.find((item) => item.id === selectedStep) ?? steps[0]
  return <section className="hiveory-capability-page hiveory-onboarding" aria-labelledby="hiveory-onboarding-title">
    <header><h1 id="hiveory-onboarding-title">Onboarding checklist</h1><p>Finish the core workflows that make Hiveory useful for parallel local agent work.</p></header>
    <div className="hiveory-onboarding-layout">
      <nav className="hiveory-onboarding-steps" aria-label="Onboarding steps">
        <div className="hiveory-onboarding-step-heading"><span>Setup</span><strong>{completedSetup}/6</strong></div>
        {steps.slice(0, 6).map((step, index) => <button type="button" key={step.id} className={selectedStep === step.id ? 'is-selected' : ''} onClick={() => onSelectStep(step.id)}><span className={step.done ? 'is-done' : ''}>{step.done ? <Check size={13} /> : index + 1}</span>{step.label}</button>)}
        <div className="hiveory-onboarding-step-heading"><span>Milestones</span><strong>{steps.slice(6).filter((step) => step.done).length}/2</strong></div>
        {steps.slice(6).map((step) => <button type="button" key={step.id} className={selectedStep === step.id ? 'is-selected' : ''} onClick={() => onSelectStep(step.id)}><span className={step.done ? 'is-done' : ''}>{step.done ? <Check size={13} /> : <Circle size={12} />}</span>{step.label}</button>)}
      </nav>
      <article className="hiveory-onboarding-detail">
        <span className={current.done ? 'hiveory-capability-status done' : 'hiveory-capability-status'}>{current.done ? 'Done' : 'Not done yet'}</span>
        {selectedStep === 'notifications' && <><h2>Turn on notifications</h2><p>Know when an agent finishes, needs attention, or is blocked. Hiveory sends the test through the native desktop notification channel.</p><div className="hiveory-capability-form-block"><strong>Notification delivery</strong><span>Windows native notification</span><button type="button" onClick={onConfirmNotifications} disabled={busy !== null}><Bell size={15} />{busy === 'notifications' ? 'Sending…' : 'Send test notification'}</button></div></>}
        {selectedStep === 'agent' && <><h2>Choose your default agent</h2><p>Start a pane faster with a detected coding agent already selected. This choice is retained for the application.</p><p className="hiveory-capability-kicker"><span />Detected on this system · {detectedAdapters.length}</p><div className="hiveory-agent-choice-grid">{adapters.map((adapter) => <button type="button" key={adapter.id} disabled={!adapter.detected} className={preferences.defaultAdapterId === adapter.id ? 'is-selected' : ''} onClick={() => onSelectAgent(adapter.id)}><Terminal size={18} /><span><strong>{adapterLabel(adapter)}</strong><small>{adapter.detected ? adapter.executable : 'Not detected'}</small></span>{preferences.defaultAdapterId === adapter.id && <CheckCircle2 size={18} />}</button>)}</div>{!adapters.length && <p className="hiveory-capability-empty">Refreshing the desktop host will discover installed coding agents.</p>}</>}
        {selectedStep === 'cli' && <><h2>Enable Hiveory CLI & skills</h2><p>Install the capability skills into the durable agent catalog. Adapter detection below comes from the local desktop host.</p><div className="hiveory-capability-card-grid"><CapabilityCard icon={<Workflow size={20} />} title="Agent Orchestration" detail="Coordinate durable work, worker dispatches, handoffs, and decision gates." state={orchestrationInstalled ? 'Installed' : 'Not installed'} /><CapabilityCard icon={<MonitorCog size={20} />} title="Computer Use" detail="Give Hiveory agents a clear local browser and desktop-operation skill." state={computerUseInstalled ? 'Installed' : 'Not installed'} /><CapabilityCard icon={<Globe2 size={20} />} title="Browser Use" detail="Drive an embedded Browser or hand work to an external browser with approvals." state={browserUseInstalled ? 'Installed' : 'Not installed'} /></div><div className="hiveory-capability-actions"><button type="button" onClick={onInstallSkills} disabled={busy !== null}><Terminal size={15} />{busy?.startsWith('install-') ? 'Installing…' : 'Install CLI & skills'}</button><button type="button" className="is-secondary" onClick={onRefresh} disabled={busy !== null}><RefreshCw size={15} />Re-check adapters</button></div><div className="hiveory-availability-list">{adapters.map((adapter) => <span key={adapter.id} className={adapter.detected ? 'is-ready' : ''}>{adapterLabel(adapter)}<small>{adapter.detected ? 'ready' : 'missing'}</small></span>)}</div></>}
        {selectedStep === 'integrations' && <><h2>Connect integrations</h2><p>Plugins and task sources are available to Hiveory agents only after their local connection is configured and validated.</p><div className="hiveory-integration-list">{plugins.length ? plugins.map((plugin) => <div key={plugin.manifest.id}><PlugZap size={18} /><span><strong>{plugin.manifest.name}</strong><small>{plugin.manifest.description}</small></span><b className={connectedPluginIds.has(plugin.manifest.id) ? 'is-connected' : ''}>{connectedPluginIds.has(plugin.manifest.id) ? 'Connected' : 'Not connected'}</b></div>) : <p className="hiveory-capability-empty">No plugin catalog is available yet. Open Plugins in Workbench to add an integration.</p>}</div><button type="button" onClick={onOpenWorkbench}><PlugZap size={15} />Open plugins in Workbench</button></>}
        {selectedStep === 'setup' && <><h2>Automate workspace setup</h2><p>Save the install or preparation command Hiveory should run in the first terminal of each new trusted worktree for this project.</p><div className="hiveory-capability-form-block"><label>Project<select value={preferences.setupProjectId ?? ''} onChange={(event) => onUpdatePreferences({ setupProjectId: event.target.value || null })}><option value="">Choose a project</option>{snapshot?.projects.map((project) => <option key={project.id} value={project.id}>{project.display_name}</option>)}</select></label><label>Setup command<input value={preferences.setupCommand} placeholder="pnpm install" onChange={(event) => onUpdatePreferences({ setupCommand: event.target.value })} /></label><button type="button" onClick={onSaveSetup} disabled={!preferences.setupProjectId || !preferences.setupCommand.trim()}><Check size={15} />Save & automate</button></div><p className="hiveory-capability-note">The command is local to Hiveory and runs only after the destination worktree is trusted.</p></>}
        {selectedStep === 'projects' && <><h2>Start work in multiple repos</h2><p>Bring your repositories into Hiveory so you can open agent workspaces without hunting for folders.</p><button type="button" onClick={onAddProject} disabled={busy !== null}><FolderPlus size={15} />Add project</button><ProjectPreview projects={snapshot?.projects ?? []} /></>}
        {selectedStep === 'multi-task' && <><h2>Multi-task</h2><p>Work in multiple isolated workspaces at once. Hiveory tracks every local worktree and the agent sessions inside it.</p><WorkspacePreview count={snapshot?.workspaces.length ?? 0} /><button type="button" onClick={onOpenWorkbench}><Workflow size={15} />Open Workbench</button></>}
        {selectedStep === 'browser' && <><h2>Use Hiveory browser</h2><p>Let agents work in the embedded Browser, open the same page in another browser, or use the user-authorized desktop. Choose the target in Browser Use settings.</p><div className="hiveory-browser-illustration"><Globe2 size={22} /><span /><span /><i /></div><div className="hiveory-capability-actions"><button type="button" onClick={onOpenWorkbench}><Globe2 size={15} />Open Browser pane</button><button type="button" className="is-secondary" onClick={() => onSelectStep('cli')}><Terminal size={15} />Open CLI &amp; skills</button></div></>}
      </article>
    </div>
  </section>
}

function AgentsPanel({ adapters, detectedAdapters, preferences, busy, onSelect, onUpdate, onPermissionMode, onRefresh }: { adapters: CodeAdapterSummary[]; detectedAdapters: CodeAdapterSummary[]; preferences: CapabilityPreferences; busy: string | null; onSelect: (id: string) => void; onUpdate: (patch: Partial<CapabilityPreferences>) => void; onPermissionMode: (mode: CapabilityPreferences['permissionMode']) => void; onRefresh: () => void }) {
  return <section className="hiveory-capability-page" aria-labelledby="hiveory-agents-title"><header><h1 id="hiveory-agents-title">Agents</h1><p>Manage coding agents, set a default, and control launch preferences.</p></header><section className="hiveory-capability-surface"><h2>Default agent</h2><p>Default agent and launch preferences are retained locally. Hiveory validates installation on every launch.</p><div className="hiveory-agent-inline-list">{adapters.map((adapter) => <button type="button" key={adapter.id} disabled={!adapter.detected} onClick={() => onSelect(adapter.id)} className={preferences.defaultAdapterId === adapter.id ? 'is-selected' : ''}><Terminal size={14} />{adapterLabel(adapter)}{preferences.defaultAdapterId === adapter.id && <Check size={14} />}</button>)}</div><SettingsRow title="Agent runtime" detail="Choose the execution environment used for new coding panes."><div className="hiveory-segmented"><button type="button" className={preferences.runtime === 'windows' ? 'is-selected' : ''} onClick={() => onUpdate({ runtime: 'windows' })}>Windows</button><button type="button" className={preferences.runtime === 'wsl' ? 'is-selected' : ''} onClick={() => onUpdate({ runtime: 'wsl' })}>WSL</button></div></SettingsRow><SettingsRow title="Agent status hooks" detail="Show working, waiting, and completed states in Hiveory."><Toggle checked={preferences.agentStatusHooks} onChange={(checked) => onUpdate({ agentStatusHooks: checked })} label="Toggle agent status hooks" /></SettingsRow><SettingsRow title="Auto-generate pane titles" detail="Keep stable, short pane names until you rename a pane yourself."><Toggle checked={preferences.autoTabTitles} onChange={(checked) => onUpdate({ autoTabTitles: checked })} label="Toggle automatic pane titles" /></SettingsRow><SettingsRow title="Keep computer awake" detail="Control whether Hiveory requests an awake system while agents work."><div className="hiveory-segmented">{(['on', 'agent', 'off'] as const).map((value) => <button type="button" key={value} className={preferences.computerAwake === value ? 'is-selected' : ''} onClick={() => onUpdate({ computerAwake: value })}>{value === 'agent' ? 'Agent' : value[0].toUpperCase() + value.slice(1)}</button>)}</div></SettingsRow><SettingsRow title="Prompt cache timer" detail="Show retained-context timing in supporting CLI panes."><Toggle checked={preferences.cacheTimer} onChange={(checked) => onUpdate({ cacheTimer: checked })} label="Toggle prompt cache timer" /></SettingsRow><SettingsRow title="Agent permissions" detail="Choose the default permission behavior for supported coding-agent panes."><div className="hiveory-segmented"><button type="button" className={preferences.permissionMode === 'yolo' ? 'is-selected' : ''} onClick={() => onPermissionMode('yolo')}>YOLO</button><button type="button" className={preferences.permissionMode === 'manual' ? 'is-selected' : ''} onClick={() => onPermissionMode('manual')}>Manual</button></div></SettingsRow><div className="hiveory-capability-list-heading"><h2>Detected agents</h2><button type="button" className="is-secondary" onClick={onRefresh} disabled={busy !== null}><RefreshCw size={14} />Refresh</button></div><div className="hiveory-adapter-settings-list">{adapters.map((adapter) => <div key={adapter.id}><Terminal size={17} /><span><strong>{adapterLabel(adapter)}</strong><small><code>{adapter.executable}</code>{adapter.detected ? ' · detected' : ' · not detected'}</small></span><b className={adapter.detected ? 'is-ready' : ''}>{adapter.detected ? 'Available' : 'Unavailable'}</b>{adapter.detected && <button type="button" onClick={() => onSelect(adapter.id)}>{preferences.defaultAdapterId === adapter.id ? 'Default' : 'Set default'}</button>}</div>)}</div>{!detectedAdapters.length && <p className="hiveory-capability-empty">No installed coding agents were detected. Install a supported CLI, then refresh.</p>}</section></section>
}

function OrchestrationPanel({ installed, preferences, adapters, busy, onInstall, onRefresh, onUpdate, onOpenWorkbench }: { installed: boolean; preferences: CapabilityPreferences; adapters: CodeAdapterSummary[]; busy: string | null; onInstall: () => void; onRefresh: () => void; onUpdate: (patch: Partial<CapabilityPreferences>) => void; onOpenWorkbench: () => void }) {
  return <section className="hiveory-capability-page" aria-labelledby="hiveory-orchestration-title"><header><h1 id="hiveory-orchestration-title">Orchestration</h1><p>Coordinate multiple coding agents through Hiveory’s durable runs.</p></header><section className="hiveory-capability-surface"><div className="hiveory-skill-hero"><span><Workflow size={23} /></span><div><h2>Orchestration skill <b className={installed ? 'is-connected' : ''}>{installed ? 'Installed' : 'Not installed'}</b></h2><p>Enables agents to coordinate work through bounded runs, worker dispatches, durable mailbox delivery, and decision gates.</p><div><button type="button" onClick={onInstall} disabled={busy !== null || installed}><Terminal size={15} />{installed ? 'Installed' : 'Install'}</button><button type="button" className="is-secondary" onClick={onRefresh} disabled={busy !== null}><RefreshCw size={15} />Re-check</button></div></div></div><div className="hiveory-coverage"><h2>Agent coverage</h2><p>Detected adapters can coordinate work when a trusted workspace is available.</p><div>{adapters.length ? adapters.map((adapter) => <span key={adapter.id}><Terminal size={13} />{adapterLabel(adapter)}<small>ready</small></span>) : <p>No coding agents are detected yet.</p>}</div></div><SettingsRow title="Nested worker depth" detail="Choose how many generations of workers may spawn more workers. One keeps coordination flat."><input className="hiveory-depth-input" type="number" min="1" max="4" value={preferences.nestedWorkerDepth} onChange={(event) => onUpdate({ nestedWorkerDepth: Math.max(1, Math.min(4, Number(event.target.value) || 1)) })} aria-label="Nested worker depth" /></SettingsRow><div className="hiveory-how-to"><h2>How to use it</h2><p>Open a trusted workspace, then use Coordination to create a bounded run and choose a worker adapter.</p><div><CapabilityCard icon={<Workflow size={18} />} title="Hand off an active task" detail="Move structured context to a worker through the durable inbox." /><CapabilityCard icon={<GitBranch size={18} />} title="Hand off to another worktree" detail="Keep parallel work isolated in its own workspace." /><CapabilityCard icon={<ListChecks size={18} />} title="Run a phased workflow" detail="Build a task graph and dispatch each ready phase." /><CapabilityCard icon={<Network size={18} />} title="Run independent work in parallel" detail="Send non-overlapping tasks to multiple workers." /></div><button type="button" onClick={onOpenWorkbench}><Workflow size={15} />Open Coordination</button></div></section></section>
}

function BrowserUsePanel({ installed, busy, preferences, onInstall, onRefresh, onOpenWorkbench, onOpenExternal, onUpdate }: { installed: boolean; busy: string | null; preferences: CapabilityPreferences; onInstall: () => void; onRefresh: () => void; onOpenWorkbench: () => void; onOpenExternal: (url: string) => void; onUpdate: (patch: Partial<CapabilityPreferences>) => void }) {
  const [url, setUrl] = useState(preferences.browserDefaultUrl)
  useEffect(() => setUrl(preferences.browserDefaultUrl), [preferences.browserDefaultUrl])
  const saveUrl = () => onUpdate({ browserDefaultUrl: url.trim() || defaultPreferences.browserDefaultUrl })
  return <section className="hiveory-capability-page" aria-labelledby="hiveory-browser-use-title"><header><h1 id="hiveory-browser-use-title">Browser Use</h1><p>Give agents a real browser surface and a controlled path to the rest of the user's computer.</p></header><section className="hiveory-capability-surface"><div className="hiveory-skill-hero"><span><Globe2 size={23} /></span><div><h2>Browser Use skill <b className={installed ? 'is-connected' : ''}>{installed ? 'Installed' : 'Not installed'}</b></h2><p>Agents can inspect and operate the embedded Hiveory Browser, open a page in an external browser, or use the approved desktop accessibility surface.</p><div><button type="button" onClick={onInstall} disabled={busy !== null || installed}><Terminal size={15} />{installed ? 'Installed' : 'Install'}</button><button type="button" className="is-secondary" onClick={onRefresh} disabled={busy !== null}><RefreshCw size={15} />Re-check</button></div></div></div><SettingsRow title="Enable Agent Browser Use" detail="Expose browser.* and computer.* tools to agents and include browser target guidance in new runs."><Toggle checked={preferences.browserUseEnabled} onChange={(checked) => onUpdate({ browserUseEnabled: checked })} label="Enable Agent Browser Use" /></SettingsRow><SettingsRow title="Browser target" detail="Choose where browser work should happen for the next agent run."><div className="hiveory-segmented hiveory-browser-target-segment"><button type="button" className={preferences.browserTarget === 'inner' ? 'is-selected' : ''} onClick={() => onUpdate({ browserTarget: 'inner' })}><Globe2 size={14} />Inner Browser</button><button type="button" className={preferences.browserTarget === 'external' ? 'is-selected' : ''} onClick={() => onUpdate({ browserTarget: 'external' })}><Globe2 size={14} />External browser</button><button type="button" className={preferences.browserTarget === 'desktop' ? 'is-selected' : ''} onClick={() => onUpdate({ browserTarget: 'desktop' })}><MonitorCog size={14} />User's PC</button></div></SettingsRow><div className="hiveory-browser-use-target-card"><strong>{preferences.browserTarget === 'inner' ? 'Embedded Hiveory Browser' : preferences.browserTarget === 'external' ? 'External browser handoff' : 'Desktop computer use'}</strong><p>{preferences.browserTarget === 'inner' ? 'Agents use browser.snapshot, browser.state, browser.navigate, browser.click, browser.fill, browser.press, browser.scroll, and browser.capture against the active Browser pane.' : preferences.browserTarget === 'external' ? 'Agents may open a page directly with browser.open_external_url or hand off the active page with browser.open_external. Existing browser sessions remain outside Hiveory and are controlled through computer.list_apps, computer.snapshot, and approved computer.action calls.' : 'Agents use computer.capabilities, computer.list_apps, computer.list_windows, computer.snapshot, and computer.action for user-authorized browsers and local apps. Shell commands remain available through computer.run.'}</p>{preferences.browserTarget === 'inner' && <button type="button" onClick={onOpenWorkbench}><Globe2 size={15} />Open Browser pane</button>}{preferences.browserTarget === 'external' && <div className="hiveory-browser-external-form"><label>Page to open<input value={url} onChange={(event) => setUrl(event.target.value)} onBlur={saveUrl} placeholder="https://www.google.com/" /></label><button type="button" onClick={() => { saveUrl(); onOpenExternal(url) }} disabled={!url.trim()}><Globe2 size={15} />Open external browser</button></div>}{preferences.browserTarget === 'desktop' && <button type="button" className="is-secondary" onClick={() => onUpdate({ browserTarget: 'desktop' })}><MonitorCog size={15} />Desktop target selected</button>}</div><div className="hiveory-capability-note"><ShieldCheck size={17} /><span>Browser and desktop actions are visible in the Agent run timeline. Hiveory asks for approval according to the selected policy before external side effects.</span></div></section></section>
}

function ComputerUsePanel({ installed, busy, onInstall, onRefresh, onOpenWorkbench }: { installed: boolean; busy: string | null; onInstall: () => void; onRefresh: () => void; onOpenWorkbench: () => void }) {
  return <section className="hiveory-capability-page" aria-labelledby="hiveory-computer-use-title"><header><h1 id="hiveory-computer-use-title">Computer Use</h1><p>Enable agents to work with local desktop and in-app browser surfaces.</p></header><section className="hiveory-capability-surface"><div className="hiveory-skill-hero"><span><MonitorCog size={23} /></span><div><h2>Computer Use skill <b className={installed ? 'is-connected' : ''}>{installed ? 'Up to date' : 'Not installed'}</b></h2><p>Gives agents explicit instructions for local Browser panes and user-authorized desktop work.</p><div><button type="button" onClick={onInstall} disabled={busy !== null || installed}><Terminal size={15} />{installed ? 'Installed' : 'Install'}</button><button type="button" className="is-secondary" onClick={onRefresh} disabled={busy !== null}><RefreshCw size={15} />Re-check</button></div></div></div><div className="hiveory-computer-use-note"><ShieldCheck size={18} /><p>Hiveory keeps Browser panes inside the app and routes external mutations through the agent’s selected approval policy.</p></div><button type="button" onClick={onOpenWorkbench}><Globe2 size={15} />Open Browser pane</button></section></section>
}

function SettingsRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) { return <div className="hiveory-settings-row"><div><strong>{title}</strong><p>{detail}</p></div>{children}</div> }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="hiveory-switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} /><span /></label> }
function CapabilityCard({ icon, title, detail, state }: { icon: ReactNode; title: string; detail: string; state?: string }) { return <article className="hiveory-capability-card"><span>{icon}</span><h3>{title}</h3><p>{detail}</p>{state && <b className={state === 'Installed' ? 'is-connected' : ''}>{state}</b>}</article> }
function ProjectPreview({ projects }: { projects: CodeSnapshot['projects'] }) { return <div className="hiveory-project-preview">{projects.length ? projects.map((project) => <div key={project.id}><GitBranch size={15} /><span><strong>{project.display_name}</strong><small>{project.root_path}</small></span><b>{project.workspace_count} workspace{project.workspace_count === 1 ? '' : 's'}</b></div>) : <p>No projects have been added.</p>}</div> }
function WorkspacePreview({ count }: { count: number }) { return <div className="hiveory-workspace-preview"><span><Workflow size={17} /><b>{count}</b><small>open workspace{count === 1 ? '' : 's'}</small></span><span><GitBranch size={17} /><b>{Math.max(0, count - 1)}</b><small>parallel worktrees</small></span></div> }
function UnavailablePanel({ title, detail }: { title: string; detail: string }) { return <section className="hiveory-capability-page"><header><h1>{title}</h1><p>{detail}</p></header><div className="hiveory-capability-placeholder"><Wrench size={22} /><strong>Not available yet</strong><span>This screen contains no simulated controls.</span></div></section> }
