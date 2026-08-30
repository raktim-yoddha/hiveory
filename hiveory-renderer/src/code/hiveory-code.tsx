import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ArrowUp, Bot, CheckCircle2, ChevronRight, ExternalLink, FileCode2, FileText, Folder, FolderOpen, GitBranch, LayoutPanelTop, Play, RefreshCw, Save, ShieldAlert, Square, Terminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import {
  hiveoryClient,
  CODEX_ADAPTER_ID,
  type CodeAdapterSummary,
  type CodeDocument,
  type CodeFileNode,
  type CodeFileTree,
  type CodeGitDiff,
  type CodeGitStatus,
  type CodePaneLayout,
  type CodePreviewSummary,
  type CodeTerminalEvent,
  type CodeTerminalKind,
  type CodeWorkspaceDetail,
  type CodeWorkspaceSummary,
} from '../api/hiveory-client'

type MonacoEnvironment = { getWorker: () => Worker }

export function HiveoryCode() {
  const [workspaces, setWorkspaces] = useState<CodeWorkspaceSummary[]>([])
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const [selectedAdapterId, setSelectedAdapterId] = useState(CODEX_ADAPTER_ID)
  const [adapterModel, setAdapterModel] = useState('')
  const [detail, setDetail] = useState<CodeWorkspaceDetail | null>(null)
  const [tree, setTree] = useState<CodeFileTree | null>(null)
  const [currentDirectory, setCurrentDirectory] = useState('')
  const [document, setDocument] = useState<CodeDocument | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [gitStatus, setGitStatus] = useState<CodeGitStatus | null>(null)
  const [gitDiff, setGitDiff] = useState<CodeGitDiff | null>(null)
  const [terminalOutput, setTerminalOutput] = useState('')
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState('http://localhost:5173')
  const [preview, setPreview] = useState<CodePreviewSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    setBusy('workspace')
    try {
      const [nextDetail, nextTree, nextStatus] = await Promise.all([
        hiveoryClient.codeWorkspace(workspaceId),
        hiveoryClient.codeFileTree({ workspace_id: workspaceId, relative_path: null }),
        hiveoryClient.codeGitStatus({ workspace_id: workspaceId }).catch(() => null),
      ])
      const decoratedDetail = nextStatus?.branch ? { ...nextDetail, summary: { ...nextDetail.summary, branch: nextStatus.branch } } : nextDetail
      setDetail(decoratedDetail)
      setTree(nextTree)
      setCurrentDirectory('')
      setGitStatus(nextStatus)
      setDocument(null)
      setGitDiff(null)
      setPreview(nextDetail.previews.find((item) => item.state === 'open') ?? null)
      setTerminalOutput('')
      setActiveTerminalId(nextDetail.terminals.find((terminal) => terminal.state === 'running')?.id ?? null)
      if (nextStatus?.branch) setWorkspaces((items) => items.map((workspace) => workspace.id === workspaceId ? { ...workspace, branch: nextStatus.branch } : workspace))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The workspace could not be loaded.')
    } finally {
      setBusy(null)
    }
  }, [])

  const refreshSnapshot = useCallback(async (workspaceId?: string) => {
    try {
      const snapshot = await hiveoryClient.codeSnapshot()
      setWorkspaces(snapshot.workspaces)
      setAdapters(snapshot.adapters)
      setSelectedAdapterId((current) => snapshot.adapters.find((item) => item.id === current && item.detected)?.id ?? snapshot.adapters.find((item) => item.detected)?.id ?? current)
      const nextWorkspaceId = workspaceId ?? snapshot.active_workspace_id ?? snapshot.workspaces[0]?.id
      if (nextWorkspaceId && snapshot.workspaces.some((workspace) => workspace.id === nextWorkspaceId)) await loadWorkspace(nextWorkspaceId)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Code mode could not connect to the local host.')
    }
  }, [loadWorkspace])

  useEffect(() => { void refreshSnapshot() }, [refreshSnapshot])

  const selectedWorkspace = detail?.summary
  const activeTerminal = detail?.terminals.find((terminal) => terminal.id === activeTerminalId) ?? null
  const adapter = adapters.find((item) => item.id === selectedAdapterId)
  const trusted = selectedWorkspace?.trust === 'trusted'

  const openWorkspace = async () => {
    const path = await hiveoryClient.chooseWorkspacePath()
    if (!path) return
    setBusy('open')
    setFeedback(null)
    try {
      const nextDetail = await hiveoryClient.openCodeWorkspace(path)
      setDetail(nextDetail)
      await refreshSnapshot(nextDetail.summary.id)
      setFeedback('Workspace opened read-only. Trust it when you are ready to run tools or save files.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The workspace could not be opened.')
    } finally {
      setBusy(null)
    }
  }

  const setWorkspaceTrust = async (grant: boolean) => {
    if (!selectedWorkspace) return
    setBusy('trust')
    try {
      const nextDetail = await hiveoryClient.trustCodeWorkspace(selectedWorkspace.id, grant)
      setDetail(nextDetail)
      setWorkspaces((items) => items.map((item) => item.id === nextDetail.summary.id ? nextDetail.summary : item))
      if (!grant) setFeedback('Workspace returned to read-only mode.')
      else setFeedback('Workspace trusted. File saves, terminals, Git reads, and local previews are enabled.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Workspace trust could not be changed.')
    } finally {
      setBusy(null)
    }
  }

  const openDirectory = async (directory: string) => {
    if (!selectedWorkspace) return
    setBusy('tree')
    try {
      setTree(await hiveoryClient.codeFileTree({ workspace_id: selectedWorkspace.id, relative_path: directory || null }))
      setCurrentDirectory(directory)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The folder could not be listed.')
    } finally {
      setBusy(null)
    }
  }

  const openFile = async (node: CodeFileNode) => {
    if (!selectedWorkspace || node.kind === 'symlink') {
      setFeedback('Symbolic links are intentionally blocked by the workspace boundary.')
      return
    }
    if (node.kind === 'directory') {
      await openDirectory(node.relative_path)
      return
    }
    setBusy('file')
    try {
      const nextDocument = await hiveoryClient.readCodeFile({ workspace_id: selectedWorkspace.id, relative_path: node.relative_path })
      setDocument(nextDocument)
      setEditorContent(nextDocument.content)
      setFeedback(null)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The file could not be opened.')
    } finally {
      setBusy(null)
    }
  }

  const saveFile = async () => {
    if (!document || !selectedWorkspace || document.read_only || !trusted) return
    setBusy('save')
    try {
      const saved = await hiveoryClient.saveCodeFile({ workspace_id: selectedWorkspace.id, relative_path: document.relative_path, content: editorContent, expected_fingerprint: document.fingerprint })
      setDocument(saved)
      setEditorContent(saved.content)
      setFeedback('Saved with an optimistic fingerprint check.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The file could not be saved. Reload it and retry.')
    } finally {
      setBusy(null)
    }
  }

  const saveLayout = async (layout: CodePaneLayout) => {
    if (!selectedWorkspace) return
    setBusy('layout')
    try {
      await hiveoryClient.saveCodeLayout({ workspace_id: selectedWorkspace.id, layout })
      setDetail((current) => current ? { ...current, layout } : current)
      setFeedback('Pane layout saved.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The pane layout could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  const handleTerminalEvent = useCallback((event: CodeTerminalEvent) => {
    if (event.kind === 'output' && event.data_base64) {
      const bytes = Uint8Array.from(atob(event.data_base64), (character) => character.charCodeAt(0))
      const text = new TextDecoder().decode(bytes)
      setTerminalOutput((current) => `${current}${text}`.slice(-250_000))
    }
    if (event.kind === 'exited') {
      setDetail((current) => current ? { ...current, terminals: current.terminals.map((terminal) => terminal.id === event.terminal_id ? { ...terminal, state: 'exited', exit_code: event.exit_code, updated_at_unix_ms: event.emitted_at_unix_ms } : terminal) } : current)
      setFeedback(`Terminal exited${event.exit_code === null ? '' : ` with code ${event.exit_code}`}.`)
    }
    if (event.kind === 'error') setFeedback(event.message ?? 'Terminal output failed.')
  }, [])

  const startTerminal = async (kind: CodeTerminalKind) => {
    if (!selectedWorkspace || !trusted) return
    if (kind === 'coding_agent' && (!adapter || !adapter.detected)) {
      setFeedback(`${adapter?.display_name ?? 'Selected coding engine'} was not detected on this host. Install it before starting a coding-agent terminal.`)
      return
    }
    setBusy(kind)
    setTerminalOutput('')
    try {
      const terminal = await hiveoryClient.startCodeTerminal({ workspace_id: selectedWorkspace.id, kind, cols: 100, rows: 28, adapter_id: kind === 'coding_agent' ? selectedAdapterId : null, model: kind === 'coding_agent' ? (adapterModel.trim() || null) : null, resume_session_id: null }, handleTerminalEvent)
      setDetail((current) => current ? { ...current, terminals: [terminal, ...current.terminals.filter((item) => item.id !== terminal.id)] } : current)
      setActiveTerminalId(terminal.id)
      setFeedback(kind === 'coding_agent' ? `${adapter?.display_name ?? 'Coding engine'} terminal started with workspace-scoped permissions.` : 'Workspace shell started.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The terminal could not be started.')
    } finally {
      setBusy(null)
    }
  }

  const stopTerminal = async (force: boolean) => {
    if (!activeTerminal) return
    if (force && !window.confirm('Force-stop this terminal and its process tree?')) return
    setBusy('stop')
    try {
      await hiveoryClient.stopCodeTerminal({ terminal_id: activeTerminal.id, force })
      setFeedback(force ? 'Terminal process tree termination requested.' : 'Interrupt sent to terminal.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The terminal could not be stopped.')
    } finally {
      setBusy(null)
    }
  }

  const refreshGit = async () => {
    if (!selectedWorkspace) return
    setBusy('git')
    try {
      setGitStatus(await hiveoryClient.codeGitStatus({ workspace_id: selectedWorkspace.id }))
      setFeedback('Git status refreshed from the repository.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Git status could not be read.')
    } finally {
      setBusy(null)
    }
  }

  const showDiff = async (relativePath: string | null) => {
    if (!selectedWorkspace) return
    setBusy('diff')
    try {
      setGitDiff(await hiveoryClient.codeGitDiff({ workspace_id: selectedWorkspace.id, relative_path: relativePath }))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The Git diff could not be read.')
    } finally {
      setBusy(null)
    }
  }

  const openPreview = async () => {
    if (!selectedWorkspace || !trusted) return
    setBusy('preview')
    try {
      const nextPreview = await hiveoryClient.openCodePreview({ workspace_id: selectedWorkspace.id, url: previewUrl })
      setPreview(nextPreview)
      setFeedback('Preview opened in a docked, sandboxed pane. The host still enforces the approved origin.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The preview URL was blocked.')
    } finally {
      setBusy(null)
    }
  }

  const goUp = () => {
    if (!currentDirectory) return
    const parent = currentDirectory.split('/').slice(0, -1).join('/')
    void openDirectory(parent)
  }

  return <section className="hiveory-code" aria-labelledby="hiveory-code-title">
    <header className="hiveory-code-header">
      <div className="hiveory-content-header"><FileCode2 size={22} aria-hidden="true" /><div><p className="hiveory-eyebrow">Code workspace</p><h1 id="hiveory-code-title">Build, test, and review in one surface</h1></div></div>
      <div className="hiveory-code-actions"><button className="is-secondary" onClick={() => void refreshSnapshot(selectedWorkspace?.id)} disabled={busy !== null}><RefreshCw size={14} />Refresh</button><button onClick={() => void openWorkspace()} disabled={busy !== null}><FolderOpen size={14} />Open folder</button></div>
    </header>
    <div className="hiveory-code-grid">
      <aside className="hiveory-code-sidebar" aria-label="Code workspaces and files">
        <div className="hiveory-code-sidebar-heading"><span>Workspaces</span><span className="hiveory-code-count">{workspaces.length}</span></div>
        <div className="hiveory-code-workspaces">{workspaces.map((workspace) => <button key={workspace.id} className={workspace.id === selectedWorkspace?.id ? 'is-active' : ''} onClick={() => void loadWorkspace(workspace.id)}><Folder size={14} /><span><strong>{workspace.display_name}</strong><small>{workspace.root_path}</small></span><span className={`hiveory-trust-dot ${workspace.trust}`} /></button>)}</div>
        {selectedWorkspace && <><div className="hiveory-code-sidebar-heading"><span>Files</span><button className="hiveory-mini-button" onClick={goUp} disabled={!currentDirectory} aria-label="Open parent folder"><ArrowUp size={13} /></button></div><div className="hiveory-code-breadcrumb"><button onClick={() => void openDirectory('')}>workspace</button>{currentDirectory && currentDirectory.split('/').map((part, index, items) => <span key={`${part}-${index}`}><ChevronRight size={12} /><button onClick={() => void openDirectory(items.slice(0, index + 1).join('/'))}>{part}</button></span>)}</div><div className="hiveory-code-file-tree" role="tree">{tree?.entries.map((node) => <button key={node.relative_path} role="treeitem" onClick={() => void openFile(node)} className={node.relative_path === document?.relative_path ? 'is-selected' : ''}>{node.kind === 'directory' ? <Folder size={14} /> : node.kind === 'symlink' ? <ShieldAlert size={14} /> : node.language ? <FileCode2 size={14} /> : <FileText size={14} />}<span>{node.name}</span>{node.kind === 'directory' && <ChevronRight size={12} />}</button>)}</div>{tree?.truncated && <p className="hiveory-code-muted">Tree truncated at 5,000 entries.</p>}</>}
        {!selectedWorkspace && <div className="hiveory-code-sidebar-empty"><FolderOpen size={22} /><p>Open a repository or folder to begin.</p></div>}
      </aside>
      <section className="hiveory-code-main">
        {!selectedWorkspace ? <div className="hiveory-code-welcome"><div className="hiveory-empty-mark"><LayoutPanelTop size={28} /></div><h2>Choose a workspace</h2><p>Folders open in read-only mode first. Trust is an explicit per-workspace decision that unlocks saves, terminals, Git reads, and local previews.</p><button onClick={() => void openWorkspace()}><FolderOpen size={15} />Open workspace folder</button></div> : <>
          <div className="hiveory-code-workspace-bar"><div><span className="hiveory-eyebrow">{selectedWorkspace.repository_name ?? 'Folder'} · {selectedWorkspace.branch ?? 'branch unavailable'}</span><h2>{selectedWorkspace.display_name}</h2></div><div className="hiveory-code-workspace-meta">{trusted ? <span className="hiveory-code-trust trusted"><CheckCircle2 size={14} />Trusted</span> : <span className="hiveory-code-trust untrusted"><ShieldAlert size={14} />Read-only</span>}{selectedWorkspace.is_git_repository && <span><GitBranch size={14} />Git</span>}</div></div>
          {!trusted && <div className="hiveory-code-trust-banner" role="status"><ShieldAlert size={17} /><div><strong>This workspace is untrusted</strong><p>Reading and listing are available. Trusting enables file saves, process execution, Git status/diff, and localhost preview.</p></div><button onClick={() => void setWorkspaceTrust(true)} disabled={busy !== null}>Trust workspace</button></div>}
          {trusted && <div className="hiveory-code-trusted-bar"><span><CheckCircle2 size={14} />Execution capabilities enabled for this workspace.</span><button className="is-secondary" onClick={() => void setWorkspaceTrust(false)} disabled={busy !== null}>Revoke trust</button></div>}
          <div className="hiveory-code-pane-toolbar"><span><LayoutPanelTop size={14} />Pane tree · {detail?.layout.nodes.length ?? 0} nodes</span><span className="hiveory-code-pane-list">{detail?.layout.nodes.filter((node) => node.children.length === 0).map((node) => <span key={node.pane_id}>{node.kind.replace('_', ' ')}</span>)}</span><button className="hiveory-mini-button" onClick={() => detail && void saveLayout(detail.layout)} disabled={busy !== null} aria-label="Save pane layout"><Save size={13} /></button></div>
          <div className="hiveory-code-workbench">
            <section className="hiveory-code-editor-pane" aria-label="File editor"><div className="hiveory-code-pane-heading"><span><FileCode2 size={14} />{document?.relative_path ?? 'Editor'}</span><div>{document && <span className="hiveory-code-language">{document.language ?? 'plain text'}</span>}<button className="hiveory-mini-button" onClick={() => void saveFile()} disabled={!document || !trusted || document.read_only || busy !== null} aria-label="Save file"><Save size={14} /></button></div></div>{document ? document.binary ? <div className="hiveory-code-binary"><ShieldAlert size={20} /><p>Binary file preview is blocked.</p></div> : <MonacoEditorPane key={`${document.relative_path}:${document.fingerprint}`} path={document.relative_path} content={editorContent} language={document.language} readOnly={!trusted || document.read_only} onChange={setEditorContent} /> : <div className="hiveory-code-editor-empty"><FileCode2 size={24} /><p>Select a file from the workspace tree.</p></div>}</section>
            <section className="hiveory-code-terminal-pane" aria-label="Workspace terminal"><div className="hiveory-code-pane-heading"><span><Terminal size={14} />Terminal</span><div className="hiveory-code-terminal-actions"><label className="hiveory-code-engine-select"><span className="hiveory-visually-hidden">Coding engine</span><select aria-label="Coding engine" value={selectedAdapterId} onChange={(event) => setSelectedAdapterId(event.target.value)} disabled={Boolean(activeTerminal) || busy !== null}>{adapters.map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.detected ? ' · ready' : ' · not detected'}</option>)}</select></label><input className="hiveory-code-model-input" aria-label="Coding engine model" value={adapterModel} onChange={(event) => setAdapterModel(event.target.value)} placeholder="default model" disabled={Boolean(activeTerminal) || busy !== null} /><button className="hiveory-mini-button" onClick={() => void startTerminal('shell')} disabled={!trusted || busy !== null} aria-label="Start shell"><Play size={13} /></button><button className="hiveory-mini-button" onClick={() => void startTerminal('coding_agent')} disabled={!trusted || !adapter?.detected || busy !== null} aria-label={`Start ${adapter?.display_name ?? 'coding agent'}`}><Bot size={13} /></button>{activeTerminal && <><button className="hiveory-mini-button" onClick={() => void stopTerminal(false)} disabled={busy !== null} aria-label="Interrupt terminal"><Square size={12} /></button><button className="hiveory-mini-button is-danger" onClick={() => void stopTerminal(true)} disabled={busy !== null} aria-label="Force stop terminal"><X size={13} /></button></>}</div></div><TerminalPane terminalId={activeTerminal?.id ?? null} output={terminalOutput} onInput={(data) => activeTerminal && void hiveoryClient.writeCodeTerminal({ terminal_id: activeTerminal.id, data })} onResize={(cols, rows) => activeTerminal && void hiveoryClient.resizeCodeTerminal({ terminal_id: activeTerminal.id, cols, rows })} /><div className="hiveory-code-terminal-status">{activeTerminal ? `${activeTerminal.kind === 'coding_agent' ? `${activeTerminal.adapter_id ?? adapter?.display_name ?? 'Coding agent'} · ` : ''}${activeTerminal.state}` : trusted ? `${adapter?.display_name ?? 'Coding engine'} · ${adapter?.detected ? 'ready' : 'not detected'} · start a shell or coding-agent terminal.` : 'Trust the workspace to execute processes.'}</div></section>
            {preview && <section className="hiveory-code-preview-pane" aria-label="Docked local preview"><div className="hiveory-code-pane-heading"><span><ExternalLink size={14} />Preview</span><div><a href={preview.url} target="_blank" rel="noreferrer" aria-label="Open preview in a new window"><ExternalLink size={13} /></a><button className="hiveory-mini-button" onClick={() => setPreview(null)} aria-label="Close docked preview"><X size={13} /></button></div></div><iframe title="Local workspace preview" src={preview.url} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" /></section>}
          </div>
          <div className="hiveory-code-bottom-grid"><section className="hiveory-code-card" aria-labelledby="hiveory-git-title"><div className="hiveory-code-card-heading"><div><GitBranch size={15} /><h3 id="hiveory-git-title">Changes</h3></div><button className="hiveory-mini-button" onClick={() => void refreshGit()} disabled={!trusted || busy !== null} aria-label="Refresh Git status"><RefreshCw size={13} /></button></div>{gitStatus ? <><div className="hiveory-code-git-summary"><span>{gitStatus.branch ?? 'detached HEAD'}</span><span>{gitStatus.ahead} ahead · {gitStatus.behind} behind</span></div><div className="hiveory-code-change-list">{gitStatus.files.length ? gitStatus.files.map((file) => <button key={file.relative_path} onClick={() => void showDiff(file.relative_path)}><span className={`hiveory-code-change-mark ${file.conflict ? 'conflict' : file.status}`}>{file.conflict ? '!' : file.status.slice(0, 1).toUpperCase()}</span><span>{file.relative_path}</span>{file.staged && <small>staged</small>}</button>) : <p className="hiveory-code-muted">Working tree clean.</p>}</div></> : <p className="hiveory-code-muted">{trusted ? 'Git status unavailable or not a repository.' : 'Trust this workspace to read Git status.'}</p>}</section><section className="hiveory-code-card hiveory-code-diff-card" aria-labelledby="hiveory-diff-title"><div className="hiveory-code-card-heading"><div><FileText size={15} /><h3 id="hiveory-diff-title">Diff / review</h3></div>{gitDiff && <button className="hiveory-mini-button" onClick={() => setGitDiff(null)} aria-label="Close diff"><X size={13} /></button>}</div>{gitDiff ? <pre>{gitDiff.content || 'No unstaged diff for this path.'}</pre> : <p className="hiveory-code-muted">Select a changed file to inspect its working-tree diff.</p>}</section><section className="hiveory-code-card" aria-labelledby="hiveory-preview-title"><div className="hiveory-code-card-heading"><div><ExternalLink size={15} /><h3 id="hiveory-preview-title">Local preview</h3></div></div><p className="hiveory-code-muted">Loads in the docked sandboxed pane. Only localhost HTTP or explicit HTTPS URLs pass host validation.</p><div className="hiveory-code-preview-form"><input value={previewUrl} onChange={(event) => setPreviewUrl(event.target.value)} aria-label="Preview URL" /><button onClick={() => void openPreview()} disabled={!trusted || busy !== null}><ExternalLink size={14} />Open</button></div></section></div>
          <div className="hiveory-code-session-strip"><span><Terminal size={14} />{detail?.terminals.length ?? 0} persisted session(s)</span><span><Bot size={14} />{adapters.filter((item) => item.detected).map((item) => item.display_name).join(' · ') || 'No coding engines detected'}</span><span><ShieldAlert size={14} />No terminal bytes are persisted</span></div>
        </>}
      </section>
    </div>
    {feedback && <div className="hiveory-feedback hiveory-code-feedback" role="status">{feedback}</div>}
  </section>
}

function MonacoEditorPane({ path, content, language, readOnly, onChange }: { path: string; content: string; language: string | null; readOnly: boolean; onChange: (value: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const contentRef = useRef(content)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  onChangeRef.current = onChange
  contentRef.current = content

  useEffect(() => {
    let disposed = false
    let editor: Monaco.editor.IStandaloneCodeEditor | undefined
    let model: Monaco.editor.ITextModel | undefined
    const environment = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment }
    environment.MonacoEnvironment ??= {
      getWorker: () => new Worker(new URL('../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' }),
    }
    void import('monaco-editor').then((monaco) => {
      if (disposed || !containerRef.current) return
      model = monaco.editor.createModel(contentRef.current, language ?? undefined, monaco.Uri.parse(`agentic://workspace/${encodeURIComponent(path)}`))
      editor = monaco.editor.create(containerRef.current, { model, theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12, lineNumbers: 'on', padding: { top: 12, bottom: 12 }, readOnly, scrollBeyondLastLine: false, renderWhitespace: 'selection', tabSize: 2 })
      editor.onDidChangeModelContent(() => onChangeRef.current(editor?.getValue() ?? ''))
      setReady(true)
    }).catch(() => setFailed(true))
    return () => { disposed = true; editor?.dispose(); model?.dispose() }
  }, [language, path, readOnly])

  return <div className="hiveory-monaco-wrap"><div className={ready ? 'hiveory-monaco-editor' : 'hiveory-monaco-editor is-hidden'} ref={containerRef} />{!ready && !failed && <div className="hiveory-code-editor-loading">Loading editor…</div>}{failed && <textarea className="hiveory-code-textarea-fallback" value={content} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label="Code editor fallback" />}</div>
}

function TerminalPane({ terminalId, output, onInput, onResize }: { terminalId: string | null; output: string; onInput: (data: string) => void; onResize: (cols: number, rows: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const lastOutputLength = useRef(0)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)
  onInputRef.current = onInput
  onResizeRef.current = onResize
  useEffect(() => {
    if (!containerRef.current) return
    const terminal = new XTerm({ convertEol: true, cursorBlink: true, fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12, theme: { background: '#0b1120', foreground: '#dbe4f0', cursor: '#22c55e', selectionBackground: '#334155' }, scrollback: 5000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current)
    fit.fit()
    terminal.onData((data) => onInputRef.current(encodeBase64(data)))
    terminalRef.current = terminal
    onResizeRef.current(terminal.cols, terminal.rows)
    return () => { terminal.dispose(); terminalRef.current = null; lastOutputLength.current = 0 }
  }, [terminalId])
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    if (output.length < lastOutputLength.current) terminal.reset()
    terminal.write(output.slice(output.length < lastOutputLength.current ? 0 : lastOutputLength.current))
    lastOutputLength.current = output.length
  }, [output])
  return <div className="hiveory-xterm" ref={containerRef} aria-label={terminalId ? 'Interactive terminal' : 'Terminal idle'} />
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}
