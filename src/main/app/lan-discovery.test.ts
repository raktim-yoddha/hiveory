import { describe, expect, it } from 'vitest'
import { firstAnswering } from './client'
import { broadcastAddresses, parseAnswer } from './lan-discovery'

describe('finding Hiveory on this Wi-Fi (ADR 0052)', () => {
  it('reads a sharing computer’s answer, and nothing else', () => {
    const answer = JSON.stringify({ app: 'hiveory', name: 'devbox', port: 7788, version: '0.30.0' })
    expect(parseAnswer(answer, '192.168.1.20')).toEqual({ name: 'devbox', address: '192.168.1.20', port: 7788, version: '0.30.0' })
    expect(parseAnswer(answer, '8.8.8.8')).toBeNull()
    expect(parseAnswer(JSON.stringify({ app: 'other', port: 7788 }), '192.168.1.20')).toBeNull()
    expect(parseAnswer(JSON.stringify({ app: 'hiveory', port: 70000 }), '192.168.1.20')).toBeNull()
    expect(parseAnswer('not json', '192.168.1.20')).toBeNull()
  })

  it('broadcasts on each private network this computer is on', () => {
    const nic = (address: string, netmask: string, internal = false) => ({ address, netmask, internal, family: 'IPv4' })
    const interfaces = { wifi: [nic('192.168.1.20', '255.255.255.0')], office: [nic('10.0.5.7', '255.255.0.0')], wan: [nic('8.8.8.8', '255.255.255.0')], lo: [nic('127.0.0.1', '255.0.0.0', true)] }
    expect(broadcastAddresses(interfaces as never).sort()).toEqual(['10.0.255.255', '192.168.1.255', '255.255.255.255'])
  })

  it('uses the first of a computer’s addresses that answers as Hiveory', async () => {
    const probe = (async (url: string) => {
      if (url.startsWith('http://100.64.0.2')) throw new Error('Tailscale is off')
      return new Response(JSON.stringify({ app: url.startsWith('http://192.168.1.20') ? 'hiveory' : 'other' }))
    }) as typeof fetch
    expect(await firstAnswering(['http://100.64.0.2:7788', 'http://192.168.1.30:7788', 'http://192.168.1.20:7788'], probe)).toBe('http://192.168.1.20:7788')
    // None answers: the one the user chose, so the error names it.
    expect(await firstAnswering(['http://100.64.0.2:7788'], probe)).toBe('http://100.64.0.2:7788')
    expect(await firstAnswering(['http://100.64.0.2:7788', 'http://192.168.1.30:7788'], probe)).toBe('http://100.64.0.2:7788')
  })
})
