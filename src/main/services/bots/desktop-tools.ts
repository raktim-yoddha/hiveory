import type { ToolFamily } from '../agent-tools/agent-tools'
import type { ToolDefinition, ToolResult } from '../agent-tools/mcp-protocol'
import { int, str, ToolError } from '../agent-tools/tool-args'
import type { ChatService } from '../chat/chat-service'
import type { BotComputers } from './bot-computer'
import { SCREEN } from './computer-image'

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
})

const shot = { type: 'boolean', default: true, description: 'Return a screenshot afterwards (default true).' }
const SETTLE_MS = 400

/**
 * A bot's own Linux computer as MCP tools (ADR 0022): a desktop it sees with
 * screenshots and drives with mouse and keyboard, a terminal (desktop_run) and
 * Chromium. Named desktop_* so they never clash with computer_* (the user's own PC).
 */
export class DesktopTools implements ToolFamily {
  constructor(
    private readonly computers: BotComputers,
    private readonly chats: ChatService
  ) {}

  handles(name: string): boolean {
    return name.startsWith('desktop_')
  }

  definitions(): ToolDefinition[] {
    return [
      tool('desktop_run', 'Run a shell command on your own Linux computer, in /workspace (your files). Returns its output and exit code.', {
        command: { type: 'string', description: 'A bash command line.' },
        timeout_seconds: { type: 'number', description: 'Up to 600; default 120.' }
      }, ['command']),
      tool('desktop_screenshot', `See your computer's screen (${SCREEN.width}×${SCREEN.height}).`),
      tool('desktop_click', 'Click at a point of the last screenshot.', {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        double: { type: 'boolean', default: false },
        screenshot: shot
      }, ['x', 'y']),
      tool('desktop_type', 'Type text where the keyboard focus is.', { text: { type: 'string' }, screenshot: shot }, ['text']),
      tool('desktop_key', 'Press keys, e.g. "Return", "ctrl+l", "ctrl+shift+t" (several separated by spaces).', { keys: { type: 'string' }, screenshot: shot }, ['keys']),
      tool('desktop_scroll', 'Scroll at the mouse position.', {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number', default: 3 },
        screenshot: shot
      }, ['direction']),
      tool('desktop_open_url', 'Open a web page in Chromium on your computer.', { url: { type: 'string' }, screenshot: shot }, ['url'])
    ]
  }

  async call(caller: { id: string }, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const chat = this.chats.get(caller.id)
    const botId = chat.botId
    if (!botId) return { text: 'Only bots have their own computer.', isError: true }
    this.computers.claim(botId, caller.id, (id) => this.chats.find(id)?.title)
    const after = async (text: string): Promise<ToolResult> => {
      if (args.screenshot === false) return { text }
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      return { text, image: { data: await this.computers.screenshot(botId), mimeType: 'image/png' } }
    }
    switch (name) {
      case 'desktop_run': {
        const result = await this.computers.run(botId, str(args, 'command'), int(args, 'timeout_seconds', 120, 1, 600) * 1000)
        return { text: `exit ${result.code ?? 'timeout'}\n${result.output || '(no output)'}`, isError: result.code !== 0 }
      }
      case 'desktop_screenshot':
        return { text: `Screen ${SCREEN.width}×${SCREEN.height}`, image: { data: await this.computers.screenshot(botId), mimeType: 'image/png' } }
      case 'desktop_click': {
        const button = (['left', 'right', 'middle'].includes(String(args.button)) ? args.button : 'left') as 'left' | 'right' | 'middle'
        await this.computers.click(botId, int(args, 'x', 0, 0, SCREEN.width - 1), int(args, 'y', 0, 0, SCREEN.height - 1), button, args.double === true)
        return after('Clicked.')
      }
      case 'desktop_type':
        await this.computers.type(botId, str(args, 'text'))
        return after('Typed.')
      case 'desktop_key':
        await this.computers.key(botId, str(args, 'keys'))
        return after('Pressed.')
      case 'desktop_scroll': {
        const direction = args.direction === 'up' ? 'up' : args.direction === 'down' ? 'down' : null
        if (!direction) throw new ToolError('direction must be "up" or "down".')
        await this.computers.scroll(botId, direction, int(args, 'amount', 3, 1, 20))
        return after('Scrolled.')
      }
      case 'desktop_open_url':
        await this.computers.openUrl(botId, str(args, 'url'))
        await new Promise((r) => setTimeout(r, 2000))
        return after('Opened.')
      default:
        return { text: `Unknown tool: ${name}`, isError: true }
    }
  }
}
