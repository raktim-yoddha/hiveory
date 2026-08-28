import { expect, test } from 'vitest'
import { agenticSuperAppClient } from './agentic-super-app-client'

test('uses an in-browser preview snapshot when no desktop host is present', async () => {
  await expect(agenticSuperAppClient.setActiveMode('code')).resolves.toMatchObject({ active_mode: 'code', protocol: { major: 2 } })
})

test('preview chat persists a turn and publishes replayable events', async () => {
  const created = await agenticSuperAppClient.createChat('Preview acceptance')
  const events: string[] = []
  const unsubscribe = agenticSuperAppClient.subscribeChat((event) => events.push(event.kind))
  const updated = await agenticSuperAppClient.startChatTurn({ conversation_id: created.id, branch_id: created.active_branch_id, text: 'Hello from the preview', attachment_ids: [], provider_account_id: 'agentic-super-app-openai', model: 'preview-model', reasoning_effort: 'auto' })
  unsubscribe()
  expect(updated.messages).toHaveLength(2)
  expect(updated.messages[0].parts).toContainEqual({ kind: 'text', text: 'Hello from the preview' })
  expect(updated.turns[0].state).toBe('completed')
  expect(events).toEqual(['assistant_text_appended', 'turn_completed'])
  await expect(agenticSuperAppClient.chatSidebar({ archived: false })).resolves.toMatchObject({ conversations: expect.arrayContaining([expect.objectContaining({ id: created.id, title: 'Preview acceptance' })]) })
})

test('preview Code enforces trust before saving and preserves the pane contract', async () => {
  const detail = await agenticSuperAppClient.openCodeWorkspace('~/phase-four-demo')
  const document = await agenticSuperAppClient.readCodeFile({ workspace_id: detail.summary.id, relative_path: 'README.md' })
  await expect(agenticSuperAppClient.saveCodeFile({ workspace_id: detail.summary.id, relative_path: document.relative_path, content: 'blocked', expected_fingerprint: document.fingerprint })).rejects.toThrow()
  const trusted = await agenticSuperAppClient.trustCodeWorkspace(detail.summary.id, true)
  expect(trusted.summary.capabilities).toContain('execute_processes')
  expect(trusted.layout.nodes.find((node) => node.pane_id === trusted.layout.root_id)?.children).toEqual([])
  const launched = await agenticSuperAppClient.launchCodePaneTerminal({
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
  const split = await agenticSuperAppClient.applyCodePaneMutation({
    workspace_id: detail.summary.id,
    expected_revision: launched.layout.revision ?? 0,
    mutation: { type: 'split', pane_id: trusted.layout.root_id, placement: 'right' },
  })
  expect(split.layout.nodes.filter((node) => node.children.length === 0)).toHaveLength(2)
  const saved = await agenticSuperAppClient.saveCodeFile({ workspace_id: detail.summary.id, relative_path: document.relative_path, content: '# Saved from preview\n', expected_fingerprint: document.fingerprint })
  expect(saved.content).toContain('Saved from preview')
})
