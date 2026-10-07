import { describe, expect, it } from 'vitest'
import type { BotView } from '@shared/domain/bot'
import type { RoutineView } from '@shared/domain/routine'
import { botOverview } from './bot-overview'

const bot = (over: Partial<BotView> = {}): BotView =>
  ({
    id: 'b1',
    name: 'Scout',
    brief: '',
    notify: true,
    autoApprove: false,
    chief: false,
    teamId: 'general',
    messaging: true,
    memory: [],
    pinned: false,
    worksOn: 'auto',
    routines: false,
    createdAt: '',
    updatedAt: '',
    home: '/home/me/Bots/b1',
    threads: 0,
    running: 0,
    ...over
  }) as BotView
const routine = (enabled: boolean, nextRunAt?: string) => ({ enabled, ...(nextRunAt ? { nextRunAt } : {}) }) as RoutineView
const base = { teamName: 'General', teamCount: 1, routines: [], switches: { browser: true, computer: false } }

describe('bot overview', () => {
  it('says what a new bot does, reaches and will not do', () => {
    const o = botOverview(bot(), base)
    expect(o.does).toEqual(['Nothing scheduled yet.', 'Remembers nothing yet.'])
    expect(o.reach).toEqual([
      'The built-in browser, signed in as itself.',
      'The apps and MCP servers you connected.',
      'Its own folder: /home/me/Bots/b1',
      "Other bots that allow messages, and its team's Chief."
    ])
    expect(o.wont).toEqual(["Won't edit files or run commands without your approval.", "Won't act on a schedule.", "Won't touch your screen."])
  })

  it('follows the settings: a Chief with full access, routines and a server computer', () => {
    const o = botOverview(bot({ chief: true, autoApprove: true, routines: true, worksOn: 'container', computer: { kind: 'docker', host: { kind: 'ssh', destination: 'devbox' } }, memory: ['a'] }), {
      ...base,
      teamName: 'Sales',
      routines: [routine(true, '2026-10-09T03:30:00.000Z'), routine(false)]
    })
    expect(o.does[0]).toBe('Leads the Sales team: hands work to its bots and brings the results back.')
    expect(o.does[1]).toMatch(/^1 routine on, next /)
    expect(o.does[2]).toBe('Remembers 1 note.')
    expect(o.reach).toContain('Its Linux computer on devbox.')
    expect(o.reach).not.toContain('The built-in browser, signed in as itself.')
    expect(o.reach).toContain('Full access: it edits files and runs commands without asking.')
    expect(o.wont).toEqual(['Routines it saves itself stay paused until you switch them on.', "Won't touch your screen."])
  })

  it('never claims the browser when Settings switched it off', () => {
    expect(botOverview(bot(), { ...base, switches: { browser: false, computer: false } }).reach[0]).toBe('The apps and MCP servers you connected.')
  })
})
