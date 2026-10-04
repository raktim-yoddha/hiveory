import { describe, expect, it } from 'vitest'
import { diffLines, diffWorthIt } from '../browser/snapshot-diff'
import type { ComputerService } from './computer-service'
import { ComputerTools } from './computer-tools'

const fakeComputer = () => {
  const calls: Array<[string, Record<string, unknown>]> = []
  const replies: Record<string, unknown> = {
    point: { x: 500, y: 300 },
    snapshot: 'Window: "Notepad"\n- edit "Text editor" [@c1]',
    screenshot: { data: 'AAAA', width: 640, height: 360, scale: 0.5, left: 0, top: 0 },
    windows: [
      { id: 7, title: 'Notepad', process: 'notepad', w: 800, h: 600, focused: true, minimized: false },
      { id: 8, title: 'Hidden helper', process: 'x', w: 1, h: 1, focused: false, minimized: false }
    ]
  }
  const computer = {
    request: async (op: string, args: Record<string, unknown> = {}) => {
      calls.push([op, args])
      return replies[op] ?? true
    }
  } as unknown as ComputerService
  return { calls, tools: new ComputerTools(computer, () => undefined) }
}
const caller = { id: 'a1', workspaceId: 'w1', petName: 'Milo' }

describe('snapshot diffs', () => {
  it('reports only added and removed lines, as a multiset', () => {
    const before = ['- button "Go" [@1]', '- text: Hello', '- text: Hello']
    const after = ['- button "Go" [@1]', '- text: Hello', '- text: Done']
    expect(diffLines(before, after)).toEqual({ added: ['- text: Done'], removed: ['- text: Hello'] })
    expect(diffWorthIt({ added: ['x'], removed: [] }, 100)).toBe(true)
    expect(diffWorthIt({ added: new Array(60).fill('x'), removed: [] }, 100)).toBe(false)
  })
})

describe('computer tools', () => {
  it('clicks refs at their centre and maps screenshot points back to the screen', async () => {
    const { tools, calls } = fakeComputer()
    await tools.call(caller, 'computer_click', { ref: '@c3', snapshot: false })
    expect(calls).toContainEqual(['point', { ref: 3 }])
    expect(calls).toContainEqual(['click', { x: 500, y: 300, button: 'left', count: 1 }])
    const shot = await tools.call(caller, 'computer_screenshot', {})
    expect(shot.image).toEqual({ data: 'AAAA', mimeType: 'image/jpeg' })
    await tools.call(caller, 'computer_click', { at: [100, 50], double: true, snapshot: false })
    expect(calls).toContainEqual(['click', { x: 200, y: 100, button: 'left', count: 2 }])
  })

  it('turns key names into Windows virtual-key chords', async () => {
    const { tools, calls } = fakeComputer()
    await tools.call(caller, 'computer_key', { keys: 'Control+Shift+Escape Win+R', snapshot: false })
    expect(calls.filter(([op]) => op === 'chord').map(([, a]) => a)).toEqual([
      { mods: [0x11, 0x10], keys: [27] },
      { mods: [0x5b], keys: [82] }
    ])
  })

  it('types into a ref by setting its value, batches steps, and returns the window afterwards', async () => {
    const { tools, calls } = fakeComputer()
    const r = await tools.call(caller, 'computer_batch', {
      steps: [
        { action: 'type', ref: '@c1', text: 'hello', submit: true },
        { action: 'wait', ms: 1 },
        { action: 'teleport' }
      ]
    })
    expect(calls).toContainEqual(['setvalue', { ref: 1, text: 'hello' }])
    expect(r.isError).toBe(true)
    expect(r.text).toContain('3. ✗ teleport')
    expect(r.text).toContain('edit "Text editor" [@c1]')
  })

  it('lists real windows only and explains a missing target', async () => {
    const { tools } = fakeComputer()
    const list = await tools.call(caller, 'computer_windows', {})
    expect(list.text).toContain('7 · "Notepad" — notepad [focused]')
    expect(list.text).not.toContain('Hidden helper')
    expect((await tools.call(caller, 'computer_click', {})).text).toMatch(/Give "ref"/)
  })
})
