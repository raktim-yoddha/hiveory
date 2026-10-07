import { describe, expect, it } from 'vitest'
import { parseStatus, type Tailscale } from '../tailscale/tailscale'
import { parseSshConfig, suggestHosts } from './ssh-config'

const config = `
# my machines
Host devbox build
  HostName devbox.tail1.ts.net
  User alex
Host *.internal !secret
  User ops
Host gpu
  HostName=10.0.0.9
  Port 2222
Include work/*.conf
Match host foo
  User nobody
Host devbox
  User other
`

describe('SSH config hosts', () => {
  it('lists named hosts with their settings, follows Include, skips patterns and Match', () => {
    const includes: string[] = []
    const hosts = parseSshConfig(config, (pattern) => {
      includes.push(pattern)
      return ['Host staging\n  HostName staging.example.com\n']
    })
    expect(includes).toEqual(['work/*.conf'])
    expect(hosts).toEqual([
      { alias: 'devbox', hostName: 'devbox.tail1.ts.net', user: 'alex' },
      { alias: 'build', hostName: 'devbox.tail1.ts.net', user: 'alex' },
      { alias: 'gpu', hostName: '10.0.0.9', port: 2222 },
      { alias: 'staging', hostName: 'staging.example.com' }
    ])
  })

  it('stops following Include loops', () => {
    expect(parseSshConfig('Include self\nHost a', () => ['Include self\nHost a'])).toEqual([{ alias: 'a' }])
  })

  it('suggests online Tailscale devices first and shows a config alias once for its device', async () => {
    const tailscale = {
      status: async () =>
        parseStatus(
          JSON.stringify({
            BackendState: 'Running',
            Self: { HostName: 'laptop', TailscaleIPs: ['100.64.0.1'], UserID: 1 },
            Peer: {
              a: { HostName: 'devbox', DNSName: 'devbox.tail1.ts.net.', TailscaleIPs: ['100.64.0.2'], OS: 'linux', Online: true, UserID: 1 },
              b: { HostName: 'nas', DNSName: 'nas.tail1.ts.net.', TailscaleIPs: ['100.64.0.3'], OS: 'linux', Online: false, UserID: 1 },
              c: { HostName: 'gpu-box', DNSName: 'gpu-box.tail1.ts.net.', TailscaleIPs: ['100.64.0.4'], OS: 'linux', Online: true, UserID: 1 }
            },
            User: { '1': { LoginName: 'alex@example.com' } }
          })
        )
    } as unknown as Tailscale
    const { tailscale: state, hosts } = await suggestHosts(tailscale, [{ alias: 'devbox', hostName: 'devbox.tail1.ts.net', user: 'alex' }])
    expect(state).toBe('running')
    expect(hosts.map((h) => [h.source, h.destination])).toEqual([
      ['tailnet', 'gpu-box.tail1.ts.net'],
      ['config', 'devbox'],
      ['tailnet', 'nas.tail1.ts.net']
    ])
    expect(hosts[1]).toMatchObject({ online: true, detail: expect.stringContaining('Tailscale') })
  })
})
