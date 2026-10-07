import { describe, expect, it } from 'vitest'
import { botReach } from './bot-reach'

const docker = { kind: 'docker' as const }
const all = { browser: true, computer: true }
const none = { browser: false, computer: false }

describe('botReach', () => {
  it('auto uses the browser and the Linux computer, never the user screen', () => {
    expect(botReach({ worksOn: 'auto', computer: docker }, all)).toEqual(['browser', 'desktop'])
    expect(botReach({ worksOn: 'auto' }, all)).toEqual(['browser'])
    expect(botReach({ worksOn: 'auto', computer: docker }, none)).toEqual(['desktop'])
  })

  it('explicit choices give exactly one family, and only while it is available', () => {
    expect(botReach({ worksOn: 'container', computer: docker }, all)).toEqual(['desktop'])
    expect(botReach({ worksOn: 'container' }, all)).toEqual([])
    expect(botReach({ worksOn: 'this-computer' }, all)).toEqual(['computer'])
    expect(botReach({ worksOn: 'this-computer' }, none)).toEqual([])
    expect(botReach({ worksOn: 'browser', computer: docker }, all)).toEqual(['browser'])
    expect(botReach({ worksOn: 'browser' }, none)).toEqual([])
  })

  it('off gives no computer at all', () => {
    expect(botReach({ worksOn: 'off', computer: docker }, all)).toEqual([])
  })
})
