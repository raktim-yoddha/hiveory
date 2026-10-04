import type { ToolFamily } from '../agent-tools/agent-tools'
import type { ToolDefinition, ToolResult } from '../agent-tools/mcp-protocol'
import { int, str, ToolError } from '../agent-tools/tool-args'
import { parseKeys } from '../browser/keys'
import type { ComputerService } from './computer-service'

type Args = Record<string, unknown>
type Caller = { id: string; workspaceId: string; petName: string }

/** Windows virtual-key codes for modifiers (the key codes from parseKeys are already VK codes). */
const MODIFIER_VK: Array<[bit: number, vk: number]> = [
  [2, 0x11], // Control
  [8, 0x10], // Shift
  [1, 0x12], // Alt
  [4, 0x5b] // Win
]
const ACTIONS = ['click', 'move', 'drag', 'type', 'key', 'scroll', 'focus', 'wait'] as const
type Action = (typeof ACTIONS)[number]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const point = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] in the last computer_screenshot image.' }
const ref = { type: 'string', description: 'Element ref from computer_snapshot, e.g. "@c12" (preferred: exact and needs no screenshot).' }
const snapshot = { type: 'boolean', default: true, description: 'Return the focused window’s elements afterwards (default true).' }

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
})

/**
 * Computer use for agents: the desktop's UI Automation tree as compact text
 * with refs (cheap, exact, no image tokens), real mouse and keyboard through
 * SendInput, screenshots when pixels are needed, and batches of steps in one call.
 */
export class ComputerTools implements ToolFamily {
  /** Screenshot geometry, so x/y from the image map back to screen pixels. */
  private shot = { scale: 1, left: 0, top: 0 }
  private lastNotice = new Map<string, number>()

  constructor(
    private readonly computer: ComputerService,
    private readonly notify: (message: string) => void
  ) {}

  handles(name: string): boolean {
    return name.startsWith('computer_')
  }

  definitions(): ToolDefinition[] {
    return [
      tool('computer_snapshot', "The focused window (or a given one) as compact text: its buttons, fields, lists and text, each with a ref like [@c12]. Fastest way to see an app — prefer it to screenshots.", {
        window: { type: 'string', description: 'Window id from computer_windows (default: the focused window).' },
        max: { type: 'integer', minimum: 20, maximum: 1000, default: 250 }
      }),
      tool('computer_screenshot', 'Capture the screen (or a region) as an image. Use when an app has no useful elements (canvas, games, images). x/y you pass later refer to this image.', {
        region: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, description: '[x, y, width, height] in screen pixels.' },
        max_width: { type: 'integer', minimum: 320, maximum: 2560, default: 1280 }
      }),
      tool('computer_click', "Click with the real mouse: on a ref (its centre) or at [x, y].", {
        ref,
        at: point,
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        double: { type: 'boolean', default: false },
        snapshot
      }),
      tool('computer_move', 'Move the mouse to a ref or point (hover).', { ref, at: point }),
      tool('computer_drag', 'Drag with the left button from one ref/point to another.', {
        from_ref: ref,
        from: point,
        to_ref: ref,
        to: point,
        snapshot
      }),
      tool('computer_type', 'Type text. With a ref, sets that field’s text directly (fast); without, types into whatever has focus. submit presses Enter.', {
        text: { type: 'string' },
        ref,
        submit: { type: 'boolean', default: false },
        snapshot
      }, ['text']),
      tool('computer_key', 'Press keys: "Enter", "Control+S", "Alt+Tab", "Win+R", "Control+Shift+Escape", or a sequence "Tab Tab Enter".', { keys: { type: 'string' }, snapshot }, ['keys']),
      tool('computer_scroll', 'Scroll with the mouse wheel (notches; positive dy scrolls down) over a ref, a point, or where the mouse is.', {
        dy: { type: 'integer', default: 5 },
        dx: { type: 'integer', default: 0 },
        ref,
        at: point,
        snapshot: { ...snapshot, default: false }
      }),
      tool('computer_windows', 'List the open windows (id, title, app) or bring one to the front.', {
        action: { type: 'string', enum: ['list', 'focus'], default: 'list' },
        window: { type: 'string', description: 'For focus: window id from the list.' },
        snapshot: { ...snapshot, default: false }
      }),
      tool(
        'computer_batch',
        'Fastest: several desktop steps in ONE call, stopping at the first failure, then one snapshot. Each step is {"action": ' +
          ACTIONS.map((a) => `"${a}"`).join('|') +
          ', ...that tool’s arguments} ("focus" takes window, "wait" takes ms). Example: [{"action":"key","keys":"Win+R"},{"action":"wait","ms":300},{"action":"type","text":"notepad","submit":true}].',
        {
          steps: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { action: { type: 'string', enum: [...ACTIONS] } }, required: ['action'] } },
          snapshot
        },
        ['steps']
      )
    ]
  }

  async call(caller: Caller, name: string, args: Args): Promise<ToolResult> {
    const last = this.lastNotice.get(caller.id) ?? 0
    if (Date.now() - last > 60000) {
      this.lastNotice.set(caller.id, Date.now())
      this.notify(`${caller.petName} is using your computer (mouse and keyboard). Turn it off in Settings › Agents.`)
    }
    try {
      return await this.dispatch(name, args)
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true }
    }
  }

  private async dispatch(name: string, args: Args): Promise<ToolResult> {
    const c = this.computer
    switch (name) {
      case 'computer_snapshot':
        return { text: await this.snapshot(args) }
      case 'computer_screenshot': {
        const region = Array.isArray(args.region) ? (args.region as number[]) : null
        const shot = await c.request<{ data: string; width: number; height: number; scale: number; left: number; top: number }>('screenshot', {
          ...(region ? { x: region[0], y: region[1], w: region[2], h: region[3] } : {}),
          maxWidth: int(args, 'max_width', 1280, 320, 2560)
        })
        this.shot = { scale: shot.scale, left: shot.left, top: shot.top }
        return {
          text: `Screenshot ${shot.width}×${shot.height}${shot.scale < 1 ? ` (scaled ${Math.round(shot.scale * 100)}%)` : ''}. Pass x/y from this image as "at"; they map to the screen.`,
          image: { data: shot.data, mimeType: 'image/jpeg' }
        }
      }
      case 'computer_windows': {
        if (str(args, 'action', false) === 'focus') {
          const id = str(args, 'window')
          await c.request('focus', { id: Number(id) })
          await sleep(120)
          return this.after(`Focused window ${id}.`, args, false)
        }
        const list = await c.request<Array<{ id: number; title: string; process: string; w: number; h: number; focused: boolean; minimized: boolean }>>('windows')
        return { text: list.filter((w) => w.minimized || (w.w > 40 && w.h > 40)).map((w) => `- ${w.id} · ${JSON.stringify(w.title)} — ${w.process}${w.focused ? ' [focused]' : ''}${w.minimized ? ' [minimized]' : ''}`).join('\n') || '(no windows)' }
      }
      case 'computer_batch': {
        const steps = Array.isArray(args.steps) ? (args.steps as Args[]) : []
        if (!steps.length) throw new ToolError('steps must be a non-empty array.')
        const log: string[] = []
        let failed = false
        for (const [i, step] of steps.entries()) {
          const action = String(step?.action ?? '') as Action
          try {
            if (!ACTIONS.includes(action)) throw new Error(`unknown action "${action}" (use ${ACTIONS.join(', ')})`)
            log.push(`${i + 1}. ✓ ${await this.act(action, step)}`)
          } catch (error) {
            log.push(`${i + 1}. ✗ ${action}: ${error instanceof Error ? error.message : String(error)}`)
            failed = true
            break
          }
        }
        if (failed && log.length < steps.length) log.push(`(stopped; ${steps.length - log.length} step(s) not run)`)
        const result = await this.after(log.join('\n'), args, true)
        return { ...result, isError: failed }
      }
      default: {
        const action = name.slice('computer_'.length) as Action
        if (!ACTIONS.includes(action)) throw new ToolError(`Unknown tool: ${name}`)
        const message = await this.act(action, args)
        return this.after(message, args, action !== 'move' && action !== 'scroll')
      }
    }
  }

  /** One desktop action — shared by the single tools and computer_batch. */
  private async act(action: Action, args: Args): Promise<string> {
    const c = this.computer
    switch (action) {
      case 'click': {
        const p = await this.resolve(args, 'ref', 'at')
        const button = (str(args, 'button', false) || 'left') as string
        await c.request('click', { x: p.x, y: p.y, button, count: args.double === true ? 2 : 1 })
        return `${args.double === true ? 'Double-clicked' : 'Clicked'} ${p.label}.`
      }
      case 'move': {
        const p = await this.resolve(args, 'ref', 'at')
        await c.request('move', p)
        return `Mouse at ${p.label}.`
      }
      case 'drag': {
        const a = await this.resolve(args, 'from_ref', 'from')
        const b = await this.resolve(args, 'to_ref', 'to')
        await c.request('drag', { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
        return `Dragged from ${a.label} to ${b.label}.`
      }
      case 'type': {
        if (typeof args.text !== 'string') throw new ToolError('Missing required argument "text".')
        const target = str(args, 'ref', false)
        if (target) await c.request('setvalue', { ref: this.refNumber(target), text: args.text })
        else await c.request('type', { text: args.text })
        if (args.submit === true) await c.request('chord', { mods: [], keys: [0x0d] })
        return `Typed ${args.text.length} character(s)${target ? ` into ${target}` : ''}${args.submit === true ? ' and pressed Enter' : ''}.`
      }
      case 'key': {
        const keys = str(args, 'keys')
        for (const chord of parseKeys(keys.replace(/\bwin(dows)?\+/gi, 'Meta+'))) {
          const mods = MODIFIER_VK.filter(([bit]) => chord.modifiers & bit).map(([, vk]) => vk)
          await c.request('chord', { mods, keys: chord.keys.map((k) => k.keyCode) })
        }
        return `Pressed ${keys}.`
      }
      case 'scroll': {
        const hasTarget = Boolean(str(args, 'ref', false)) || Array.isArray(args.at)
        const p = hasTarget ? await this.resolve(args, 'ref', 'at') : { x: -1, y: -1 }
        await c.request('scroll', { x: p.x, y: p.y, dy: int(args, 'dy', 5, -100, 100), dx: int(args, 'dx', 0, -100, 100) })
        return 'Scrolled.'
      }
      case 'focus': {
        const id = str(args, 'window')
        await c.request('focus', { id: Number(id) })
        await sleep(120)
        return `Focused window ${id}.`
      }
      case 'wait': {
        const ms = int(args, 'ms', 300, 0, 10000)
        await sleep(ms)
        return `Waited ${ms} ms.`
      }
    }
  }

  private refNumber(value: string): number {
    const m = /^@?c?(\d+)$/i.exec(value.trim())
    if (!m) throw new ToolError(`"${value}" is not an element ref like @c12.`)
    return Number(m[1])
  }

  /** A ref (exact centre) or a screenshot point mapped back to screen pixels. */
  private async resolve(args: Args, refKey: string, pointKey: string): Promise<{ x: number; y: number; label: string }> {
    const r = str(args, refKey, false)
    if (r) {
      const p = await this.computer.request<{ x: number; y: number }>('point', { ref: this.refNumber(r) })
      return { ...p, label: r }
    }
    const at = args[pointKey]
    if (Array.isArray(at) && at.length === 2 && at.every((n) => typeof n === 'number')) {
      const [x, y] = at as [number, number]
      return { x: Math.round(this.shot.left + x / this.shot.scale), y: Math.round(this.shot.top + y / this.shot.scale), label: `(${x}, ${y})` }
    }
    throw new ToolError(`Give "${refKey}" (from computer_snapshot) or "${pointKey}" ([x, y] from computer_screenshot).`)
  }

  private async snapshot(args: Args): Promise<string> {
    const window = str(args, 'window', false)
    return this.computer.request<string>('snapshot', { ...(window ? { id: Number(window) } : {}), max: int(args, 'max', 250, 20, 1000) })
  }

  /** Lets the UI react, then shows the focused window — the next view comes with the action. */
  private async after(message: string, args: Args, byDefault: boolean): Promise<ToolResult> {
    const wanted = typeof args.snapshot === 'boolean' ? args.snapshot : byDefault
    if (!wanted) return { text: message }
    await sleep(150)
    try {
      return { text: `${message}\n\n${await this.snapshot({})}` }
    } catch (error) {
      return { text: `${message}\n\n(could not read the window: ${error instanceof Error ? error.message : String(error)})` }
    }
  }
}
