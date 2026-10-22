import { describe, expect, it, vi } from 'vitest'
import { sendPush } from './push'
import { isPrivateIPv4, lanAddresses, Sharing } from './sharing'

vi.mock('./push', () => ({ sendPush: vi.fn(async () => []) }))

describe('On this network (ADR 0039)', () => {
  it('listens only on private local addresses, never public or Tailscale ones', () => {
    expect(['10.0.0.4', '192.168.1.20', '172.16.0.1', '172.31.9.9'].every(isPrivateIPv4)).toBe(true)
    expect(['100.101.2.3', '172.32.0.1', '8.8.8.8', '127.0.0.1'].some(isPrivateIPv4)).toBe(false)
    const nic = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family, netmask: '', mac: '', cidr: null })
    expect(lanAddresses({ wifi: [nic('192.168.1.20'), nic('fe80::1', false, 'IPv6')], lo: [nic('127.0.0.1', true)], ts: [nic('100.64.0.5')] } as never)).toEqual(['192.168.1.20'])
  })
})

describe('phone notifications (ADR 0027, 0053)', () => {
  it('carry a fixed sentence and ids only, with the address the phone knows', () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
    const sharing = new Sharing({} as never, log, '', '0.0.0')
    Object.assign(sharing as unknown as Record<string, unknown>, { server: { pushTokens: () => ['ExponentPushToken[a]'], dropPushToken: () => undefined }, lan: ['192.168.1.20'] })
    sharing.notifyPhones('A bot needs your yes.', { kind: 'approval', botId: 'b1' })
    expect(sendPush).toHaveBeenCalledWith(['ExponentPushToken[a]'], { title: 'Hiveory', body: 'A bot needs your yes.', data: { kind: 'approval', botId: 'b1', from: '192.168.1.20' } })
  })
})
