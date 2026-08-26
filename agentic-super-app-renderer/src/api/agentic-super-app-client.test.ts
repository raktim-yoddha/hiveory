import { expect, test } from 'vitest'
import { agenticSuperAppClient } from './agentic-super-app-client'

test('uses an in-browser preview snapshot when no desktop host is present', async () => {
  await expect(agenticSuperAppClient.setActiveMode('code')).resolves.toMatchObject({ active_mode: 'code', protocol: { major: 1 } })
})
