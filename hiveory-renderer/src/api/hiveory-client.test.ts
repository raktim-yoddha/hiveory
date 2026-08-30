import { expect, test } from 'vitest'
import { hiveoryClient } from './hiveory-client'

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

  const afterWorkspaceRemoval = await hiveoryClient.removeCodeWorkspace({ workspace_id: isolated.summary.id, force: true })
  expect(afterWorkspaceRemoval.workspaces.map((workspace) => workspace.id)).not.toContain(isolated.summary.id)
  expect(afterWorkspaceRemoval.projects.find((project) => project.id === primary.summary.project_id)?.workspace_count).toBe(1)
  await expect(hiveoryClient.removeCodeWorkspace({ workspace_id: primary.summary.id, force: true })).rejects.toThrow('primary workspace')

  const afterProjectRemoval = await hiveoryClient.removeCodeProject({ project_id: primary.summary.project_id, force: true })
  expect(afterProjectRemoval.projects.map((project) => project.id)).not.toContain(primary.summary.project_id)
})
