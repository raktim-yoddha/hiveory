import { describe, expect, it } from 'vitest'
import { discover } from '../../app/client'
import { isTailnetAddress, parseStatus, parseWhois, type Tailscale } from './tailscale'

const status = JSON.stringify({
  BackendState: 'Running',
  Self: {
    HostName: 'laptop',
    DNSName: 'laptop.tail1.ts.net.',
    TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
    OS: 'windows',
    UserID: 1
  },
  Peer: {
    a: {
      HostName: 'devbox',
      DNSName: 'devbox.tail1.ts.net.',
      TailscaleIPs: ['fd7a:115c:a1e0::2', '100.64.0.2'],
      OS: 'linux',
      Online: true,
      UserID: 1
    },
    b: {
      HostName: 'ci',
      DNSName: 'ci.tail1.ts.net.',
      TailscaleIPs: ['100.64.0.3'],
      OS: 'linux',
      Online: true,
      UserID: 9,
      Tags: ['tag:server']
    },
    c: {
      HostName: 'phone',
      DNSName: 'phone.tail1.ts.net.',
      TailscaleIPs: ['100.64.0.4'],
      OS: 'iOS',
      Online: false,
      UserID: 1
    },
    d: {
      HostName: 'friend',
      TailscaleIPs: ['100.64.0.5'],
      Online: true,
      UserID: 2
    }
  },
  User: {
    '1': { LoginName: 'alex@example.com' },
    '2': { LoginName: 'sam@example.com' },
    '9': { LoginName: 'tagged-devices' }
  }
})

describe('Tailscale', () => {
  it('normalizes status: IPv4 first, owners, tagged nodes owned by nobody, online first', () => {
    const s = parseStatus(status)
    expect(s.state).toBe('running')
    expect(s.self).toMatchObject({
      name: 'laptop',
      dnsName: 'laptop.tail1.ts.net',
      ip: '100.64.0.1',
      online: true,
      owner: 'alex@example.com'
    })
    expect(s.devices.map((d) => d.name)).toEqual(['ci', 'devbox', 'friend', 'phone'])
    expect(s.devices.find((d) => d.name === 'devbox')).toMatchObject({
      ip: '100.64.0.2',
      owner: 'alex@example.com'
    })
    expect(s.devices.find((d) => d.name === 'ci')!.owner).toBe('')
  })

  it('reports a stopped or signed-out Tailscale', () => {
    expect(parseStatus(JSON.stringify({ BackendState: 'NeedsLogin' }))).toEqual({ state: 'stopped', devices: [] })
  })

  it('reads who a peer belongs to; tagged nodes belong to nobody', () => {
    expect(
      parseWhois(
        JSON.stringify({
          Node: {},
          UserProfile: { LoginName: 'alex@example.com' }
        })
      )
    ).toBe('alex@example.com')
    expect(
      parseWhois(
        JSON.stringify({
          Node: { Tags: ['tag:ci'] },
          UserProfile: { LoginName: 'alex@example.com' }
        })
      )
    ).toBe('')
  })

  it('knows the tailnet address ranges only', () => {
    expect(isTailnetAddress('100.64.0.1')).toBe(true)
    expect(isTailnetAddress('::ffff:100.127.255.1')).toBe(true)
    expect(isTailnetAddress('fd7a:115c:a1e0::5')).toBe(true)
    expect(isTailnetAddress('100.128.0.1')).toBe(false)
    expect(isTailnetAddress('100.63.0.1')).toBe(false)
    expect(isTailnetAddress('127.0.0.1')).toBe(false)
    expect(isTailnetAddress('192.168.1.10')).toBe(false)
  })

  it('discovers Hiveory servers on the tailnet and marks the owner’s devices', async () => {
    const tailscale = {
      status: async () => parseStatus(status)
    } as unknown as Tailscale
    const probed: string[] = []
    const probe = (async (url: string) => {
      probed.push(url)
      if (url.startsWith('http://100.64.0.2:7788')) return new Response(JSON.stringify({ app: 'hiveory', version: '1.2.3' }))
      throw new Error('refused')
    }) as typeof fetch
    const found = await discover(tailscale, probe)
    expect(found.state).toBe('running')
    expect(found.devices[0]).toMatchObject({
      name: 'devbox',
      mine: true,
      hiveory: { version: '1.2.3', port: 7788 }
    })
    expect(found.devices.find((d) => d.name === 'friend')).toMatchObject({
      mine: false
    })
    expect(found.devices.find((d) => d.name === 'ci')).toMatchObject({
      mine: false
    })
    // Offline devices are never probed.
    expect(probed.some((u) => u.includes('100.64.0.4'))).toBe(false)
  })
})
