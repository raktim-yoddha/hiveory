import { expect, test } from 'vitest'
import { hiveoryClient, normalizeBrowserInput } from './hiveory-client'

test('normalizes browser addresses and uses Google for search text', () => {
  expect(normalizeBrowserInput('localhost:5173/dashboard')).toBe('http://localhost:5173/dashboard')
  expect(normalizeBrowserInput('localhost/dashboard')).toBe('http://localhost/dashboard')
  expect(normalizeBrowserInput('example.com:8443')).toBe('https://example.com:8443/')
  expect(normalizeBrowserInput('https://example.com/docs')).toBe('https://example.com/docs')
  expect(normalizeBrowserInput('tauri webview')).toBe('https://www.google.com/search?q=tauri%20webview')
  expect(() => normalizeBrowserInput('file:///tmp/index.html')).toThrow('HTTP and HTTPS')
  expect(() => normalizeBrowserInput('mailto:user@example.com')).toThrow('HTTP and HTTPS')
})

test('uses an in-browser preview snapshot when no desktop host is present', async () => {
  await expect(hiveoryClient.setActiveMode('code')).resolves.toMatchObject({ active_mode: 'code', protocol: { major: 2 } })
})

test('preview chat persists a turn and publishes replayable events', async () => {
  const created = await hiveoryClient.createChat('Preview acceptance')
  const events: string[] = []
  const unsubscribe = hiveoryClient.subscribeChat((event) => events.push(event.kind))
  const updated = await hiveoryClient.startChatTurn({ conversation_id: created.id, branch_id: created.active_branch_id, text: 'Hello from the preview', attachment_ids: [], provider_account_id: 'hiveory-openai', model: 'preview-model', reasoning_effort: 'auto' })
  unsubscribe()
  expect(updated.messages).toHaveLength(2)
  expect(updated.messages[0].parts).toContainEqual({ kind: 'text', text: 'Hello from the preview' })
  expect(updated.turns[0].state).toBe('completed')
  expect(events).toEqual(['assistant_text_appended', 'turn_completed'])
  await expect(hiveoryClient.chatSidebar({ archived: false })).resolves.toMatchObject({ conversations: expect.arrayContaining([expect.objectContaining({ id: created.id, title: 'Preview acceptance' })]) })
})

test('preview Code enforces trust before saving and preserves the pane contract', async () => {
  const detail = await hiveoryClient.openCodeWorkspace('~/phase-four-demo')
  const document = await hiveoryClient.readCodeFile({ workspace_id: detail.summary.id, relative_path: 'README.md' })
  await expect(hiveoryClient.saveCodeFile({ workspace_id: detail.summary.id, relative_path: document.relative_path, content: 'blocked', expected_fingerprint: document.fingerprint })).rejects.toThrow()
  const trusted = await hiveoryClient.trustCodeWorkspace(detail.summary.id, true)
  expect(trusted.summary.capabilities).toContain('execute_processes')
  expect(trusted.layout.nodes.find((node) => node.pane_id === trusted.layout.root_id)?.children).toEqual([])
  const launched = await hiveoryClient.launchCodePaneTerminal({
    workspace_id: detail.summary.id,
    pane_id: trusted.layout.root_id,
    expected_revision: trusted.layout.revision ?? 0,
    kind: 'shell',
    adapter_id: null,
    model: null,
    cols: 80,
    rows: 24,
  })
  expect(launched.terminal.state).toBe('running')
  expect(launched.layout.nodes.find((node) => node.pane_id === trusted.layout.root_id)?.kind).toBe('terminal')
  const split = await hiveoryClient.applyCodePaneMutation({
    workspace_id: detail.summary.id,
    expected_revision: launched.layout.revision ?? 0,
    mutation: { type: 'split', pane_id: trusted.layout.root_id, placement: 'right' },
  })
  expect(split.layout.nodes.filter((node) => node.children.length === 0)).toHaveLength(2)
  const saved = await hiveoryClient.saveCodeFile({ workspace_id: detail.summary.id, relative_path: document.relative_path, content: '# Saved from preview\n', expected_fingerprint: document.fingerprint })
  expect(saved.content).toContain('Saved from preview')
})

test('preview creates root Markdown documents with unique names and keeps them writable', async () => {
  const detail = await hiveoryClient.openCodeWorkspace('~/markdown-document-demo')
  const trusted = await hiveoryClient.trustCodeWorkspace(detail.summary.id, true)
  const first = await hiveoryClient.createCodePaneMarkdown({
    workspace_id: trusted.summary.id,
    pane_id: trusted.layout.root_id,
    expected_revision: trusted.layout.revision ?? 0,
  })

  expect(first.document.relative_path).toBe('untitled.md')
  expect(first.document.language).toBe('markdown')
  expect(first.layout.nodes.find((node) => node.pane_id === first.layout.root_id)).toMatchObject({
    kind: 'markdown',
    resource_id: 'untitled.md',
    title: 'untitled.md',
  })

  const secondPane = await hiveoryClient.applyCodePaneMutation({
    workspace_id: trusted.summary.id,
    expected_revision: first.layout.revision ?? 0,
    mutation: { type: 'split', pane_id: first.layout.root_id, placement: 'right' },
  })
  const second = await hiveoryClient.createCodePaneMarkdown({
    workspace_id: trusted.summary.id,
    pane_id: secondPane.layout.nodes.find((node) => node.children.length === 0 && node.kind === 'empty')?.pane_id ?? '',
    expected_revision: secondPane.layout.revision ?? 0,
  })

  expect(second.document.relative_path).toBe('untitled-2.md')
  const saved = await hiveoryClient.saveCodeFile({
    workspace_id: trusted.summary.id,
    relative_path: second.document.relative_path,
    content: '# Markdown from preview\n',
    expected_fingerprint: second.document.fingerprint,
  })
  expect(saved.content).toBe('# Markdown from preview\n')
})

test('preview keeps projects as parents of primary and isolated workspaces', async () => {
  const primary = await hiveoryClient.addCodeProject('~/hierarchy-demo')
  const before = await hiveoryClient.codeSnapshot()
  const project = before.projects.find((candidate) => candidate.id === primary.summary.project_id)

  expect(project).toMatchObject({
    primary_workspace_id: primary.summary.id,
    workspace_count: 1,
    kind: 'git',
  })

  const isolated = await hiveoryClient.createCodeWorkspace({
    project_id: primary.summary.project_id,
    name: 'Feature branch',
    base_ref: 'HEAD',
    branch_name: 'feature/hierarchy-demo',
  })
  const after = await hiveoryClient.codeSnapshot()
  const updatedProject = after.projects.find((candidate) => candidate.id === primary.summary.project_id)

  expect(isolated.summary).toMatchObject({
    project_id: primary.summary.project_id,
    workspace_kind: 'managed_worktree',
    managed_by_app: true,
    display_name: 'Feature branch',
  })
  expect(updatedProject?.workspace_count).toBe(2)
  expect(after.workspaces.map((workspace) => workspace.id)).toEqual(expect.arrayContaining([primary.summary.id, isolated.summary.id]))
})

test('preview removes secondary workspaces without allowing primary deletion', async () => {
  const primary = await hiveoryClient.addCodeProject('~/removal-hierarchy-demo')
  const isolated = await hiveoryClient.createCodeWorkspace({
    project_id: primary.summary.project_id,
    name: 'Temporary workspace',
    base_ref: 'HEAD',
    branch_name: 'feature/removal-hierarchy-demo',
  })
  const child = await hiveoryClient.createCodeWorkspace({
    project_id: primary.summary.project_id,
    name: 'Nested workspace',
    base_ref: 'HEAD',
    branch_name: 'feature/nested-removal-hierarchy-demo',
  })
  await hiveoryClient.setCodeWorkspaceParent({ workspace_id: child.summary.id, parent_workspace_id: isolated.summary.id })

  const afterWorkspaceRemoval = await hiveoryClient.removeCodeWorkspace({ workspace_id: isolated.summary.id, force: true })
  expect(afterWorkspaceRemoval.workspaces.map((workspace) => workspace.id)).not.toContain(isolated.summary.id)
  expect(afterWorkspaceRemoval.workspaces.find((workspace) => workspace.id === child.summary.id)?.parent_workspace_id).toBeNull()
  expect(afterWorkspaceRemoval.projects.find((project) => project.id === primary.summary.project_id)?.workspace_count).toBe(2)
  await expect(hiveoryClient.removeCodeWorkspace({ workspace_id: primary.summary.id, force: true })).rejects.toThrow('primary workspace')

  const afterProjectRemoval = await hiveoryClient.removeCodeProject({ project_id: primary.summary.project_id, force: true })
  expect(afterProjectRemoval.projects.map((project) => project.id)).not.toContain(primary.summary.project_id)
})

test('preview makes workspace menu mutations durable and rejects hierarchy cycles', async () => {
  const primary = await hiveoryClient.addCodeProject('~/menu-actions-demo')
  const child = await hiveoryClient.createCodeWorkspace({
    project_id: primary.summary.project_id,
    name: 'Menu child',
    base_ref: 'HEAD',
    branch_name: 'feature/menu-child',
  })

  const renamed = await hiveoryClient.updateCodeWorkspace({ workspace_id: child.summary.id, display_name: 'Renamed child' })
  expect(renamed.summary.display_name).toBe('Renamed child')
  const linked = await hiveoryClient.setCodeWorkspaceParent({ workspace_id: child.summary.id, parent_workspace_id: primary.summary.id })
  expect(linked.summary.parent_workspace_id).toBe(primary.summary.id)
  await expect(hiveoryClient.setCodeWorkspaceParent({ workspace_id: primary.summary.id, parent_workspace_id: child.summary.id })).rejects.toThrow()

  const trusted = await hiveoryClient.trustCodeWorkspace(child.summary.id, true)
  const terminal = await hiveoryClient.startCodeTerminal({ workspace_id: child.summary.id, kind: 'shell', cols: 80, rows: 24, adapter_id: null, model: null, resume_session_id: null }, () => undefined)
  expect(terminal.state).toBe('running')
  await expect(hiveoryClient.stopCodeTerminal({ terminal_id: terminal.id, force: true })).resolves.toBe(true)
  const slept = await hiveoryClient.codeWorkspace(trusted.summary.id)
  expect(slept.terminals[0]?.state).toBe('interrupted')
})
