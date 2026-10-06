import type { ToolFamily } from '../agent-tools/agent-tools'
import type { ToolDefinition, ToolResult } from '../agent-tools/mcp-protocol'
import { str } from '../agent-tools/tool-args'
import type { ChatService } from '../chat/chat-service'
import type { BotService } from './bot-service'

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
})

const BOT = { type: 'string', description: 'The teammate: its exact name (from list_bots) or id.' }
const FACT = { type: 'string', description: 'One short, lasting fact (no secrets).' }

/**
 * MCP tools for a bot's thread (caller id = the thread's chat id): its memory,
 * and — for the Chief of Staff, or bots allowed to message — the team.
 */
export class BotTools implements ToolFamily {
  private static readonly NAMES = new Set(['list_bots', 'delegate_bot', 'ask_bot', 'remember', 'forget'])

  constructor(
    private readonly bots: BotService,
    private readonly chats: ChatService
  ) {}

  handles(name: string): boolean {
    return BotTools.NAMES.has(name)
  }

  definitions(): ToolDefinition[] {
    return [
      tool('remember', 'Save a lasting fact to your memory; every new conversation of yours starts with it.', { fact: FACT }, ['fact']),
      tool('forget', 'Remove a note from your memory (pass its exact text).', { fact: FACT }, ['fact']),
      tool('list_bots', "The teammates you can reach: name, id, role, brief and whether they're busy."),
      tool(
        'delegate_bot',
        'Chief of Staff only. Assign work to a teammate in a new conversation of theirs. Returns at once; their result arrives in this conversation as a new message and wakes you. Give a clear, self-contained brief.',
        { bot: BOT, brief: { type: 'string', description: 'What to do, the context they need and what done looks like.' } },
        ['bot', 'brief']
      ),
      tool(
        'ask_bot',
        "Ask a teammate a short question and wait for the answer (up to 10 minutes). Use delegate_bot for real work, not this.",
        { bot: BOT, question: { type: 'string', description: 'The question, with the context needed to answer it.' } },
        ['bot', 'question']
      )
    ]
  }

  async call(caller: { id: string }, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const botId = this.chats.get(caller.id).botId
    if (!botId) return { text: 'Only bots can use these tools.', isError: true }
    switch (name) {
      case 'remember': {
        const memory = this.bots.remember(botId, str(args, 'fact'))
        return { text: `Remembered. You keep ${memory.length} note${memory.length === 1 ? '' : 's'}.` }
      }
      case 'forget': {
        this.bots.forget(botId, str(args, 'fact'))
        return { text: 'Forgotten.' }
      }
      case 'list_bots': {
        const team = this.bots.reachable(caller.id)
        if (!team.length) return { text: 'No teammates you can reach yet. The user adds bots in Bots mode.' }
        const busy = new Set(this.bots.list().filter((b) => b.running > 0).map((b) => b.id))
        return {
          text: team
            .map((b) => `- ${b.name} (id ${b.id})${b.chief ? ' · Chief of Staff' : ''} · ${busy.has(b.id) ? 'busy' : 'free'}${b.cliId ? '' : ' · no engine set'}\n  ${b.brief.split('\n')[0]?.slice(0, 200) || '(no brief)'}`)
            .join('\n')
        }
      }
      case 'delegate_bot': {
        const { bot } = this.bots.delegate(caller.id, str(args, 'bot'), str(args, 'brief'))
        return { text: `Assigned to ${bot}. Their result will arrive here as a new message; end your turn or carry on with other work. Do not claim it is done until it arrives.` }
      }
      case 'ask_bot':
        return { text: await this.bots.ask(caller.id, str(args, 'bot'), str(args, 'question')) }
      default:
        return { text: `Unknown tool: ${name}`, isError: true }
    }
  }
}
