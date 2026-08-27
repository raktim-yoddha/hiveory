import { expect, test } from 'vitest'
import { agenticSuperAppClient } from './agentic-super-app-client'

test('uses an in-browser preview snapshot when no desktop host is present', async () => {
  await expect(agenticSuperAppClient.setActiveMode('code')).resolves.toMatchObject({ active_mode: 'code', protocol: { major: 1 } })
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
