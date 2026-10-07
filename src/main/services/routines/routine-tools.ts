import { REPEAT_PRESETS, type RoutineSchedule } from '@shared/domain/routine'
import { compileRepeat, cronProblem, nextRuns, validTimezone } from '@shared/domain/routine-schedule'
import type { ToolFamily } from '../agent-tools/agent-tools'
import type { ToolDefinition, ToolResult } from '../agent-tools/mcp-protocol'
import { int, str, ToolError } from '../agent-tools/tool-args'
import type { RoutineService } from './routine-service'

const REPEATS = ['once', 'interval', ...REPEAT_PRESETS.filter((p) => p !== 'custom'), 'cron'] as const
type Repeat = (typeof REPEATS)[number]

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
})

/** "Thu 8 Oct, 09:00" in the routine's zone. */
const at = (d: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)

/**
 * A bot's own routines over MCP (ADR 0028): it can see them, and save new ones, always paused.
 * Nothing it saves runs until the user switches it on, so a bot can never put itself on a schedule.
 */
export class RoutineTools implements ToolFamily {
  private static readonly NAMES = new Set(['schedule_routine', 'list_routines'])

  constructor(
    private readonly routines: () => RoutineService,
    /** The bot behind a thread, if the thread is a bot's. */
    private readonly botOf: (chatId: string) => string | undefined,
    /** This computer's timezone, used when the bot names none. */
    private readonly zone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    private readonly now: () => number = Date.now
  ) {}

  handles(name: string): boolean {
    return RoutineTools.NAMES.has(name)
  }

  definitions(): ToolDefinition[] {
    return [
      tool('list_routines', 'Your routines: work you start on your own on a schedule. Shows whether each is on or paused and when it runs next.'),
      tool(
        'schedule_routine',
        'Save a routine for yourself: work you start on your own on a schedule, each run in a fresh conversation with these instructions. It is saved PAUSED: tell the user it waits for them to switch it on (your Routines tab). Only works if the user allowed you to run on a schedule.',
        {
          name: { type: 'string', description: 'A short title, e.g. "Morning inbox report".' },
          instructions: { type: 'string', description: 'What to do on every run, complete on its own: what to look at, what to produce, what needs approval.' },
          first_run: { type: 'string', description: 'The first run as ISO 8601 with an offset, e.g. 2026-10-09T09:00:00+05:30. Repeats keep its time of day.' },
          repeat: { type: 'string', enum: [...REPEATS], description: 'once · interval (every N minutes) · daily · weekdays · weekly · selected-days · monthly · month-end · yearly · cron' },
          every_minutes: { type: 'number', description: 'For interval: 5 to 1440.' },
          days: { type: 'array', items: { type: 'number' }, description: 'For selected-days: weekdays, 0 = Sunday … 6 = Saturday.' },
          cron: { type: 'string', description: 'For cron only: five fields, minute hour day-of-month month day-of-week.' },
          timezone: { type: 'string', description: "IANA zone, e.g. Asia/Kolkata. Default: this computer's." }
        },
        ['name', 'instructions', 'first_run', 'repeat']
      )
    ]
  }

  async call(caller: { id: string }, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const botId = this.botOf(caller.id)
    if (!botId) return { text: 'Only bots have routines.', isError: true }
    try {
      return name === 'list_routines' ? this.list(botId) : this.schedule(botId, args)
    } catch (error) {
      if (error instanceof ToolError) throw error
      throw new ToolError(error instanceof Error ? error.message : String(error))
    }
  }

  private list(botId: string): ToolResult {
    const mine = this.routines().list(botId)
    if (!mine.length) return { text: 'You have no routines yet.' }
    return {
      text: mine
        .map((r) => {
          const next = r.nextRunAt ? `next ${at(new Date(r.nextRunAt), r.timezone)}` : 'no runs left'
          const last = r.lastRun ? ` · last run ${r.lastRun.status}` : ''
          return `- ${r.name} · ${r.enabled ? 'on' : 'paused'} · ${next}${last}`
        })
        .join('\n')
    }
  }

  private schedule(botId: string, args: Record<string, unknown>): ToolResult {
    const timezone = str(args, 'timezone', false) || this.zone()
    if (!validTimezone(timezone)) throw new ToolError(`Unknown timezone "${timezone}". Use an IANA name such as Asia/Kolkata.`)
    const first = new Date(str(args, 'first_run'))
    if (Number.isNaN(first.getTime())) throw new ToolError('first_run must be an ISO 8601 date and time, e.g. 2026-10-09T09:00:00+05:30.')
    const repeat = str(args, 'repeat') as Repeat
    if (!REPEATS.includes(repeat)) throw new ToolError(`repeat must be one of: ${REPEATS.join(', ')}.`)
    const schedule = this.scheduleOf(repeat, args, first, timezone)
    const startsAt = first.toISOString()
    const upcoming = nextRuns({ schedule, startsAt, timezone }, new Date(this.now()), 3)
    if (!upcoming.length) throw new ToolError('That time has already passed. Pick a first run in the future.')
    const routine = this.routines().create({
      name: str(args, 'name').slice(0, 80),
      botId,
      prompt: str(args, 'instructions'),
      schedule,
      startsAt,
      timezone,
      enabled: false
    })
    return {
      text: `Saved "${routine.name}", paused. Next runs once it is on: ${upcoming.map((d) => at(d, timezone)).join(' · ')} (${timezone}). Tell the user it waits for them to switch it on in your Routines tab.`
    }
  }

  private scheduleOf(repeat: Repeat, args: Record<string, unknown>, first: Date, timezone: string): RoutineSchedule {
    if (repeat === 'once') return { kind: 'once' }
    if (repeat === 'interval') return { kind: 'interval', everyMinutes: int(args, 'every_minutes', 60, 5, 1440) }
    if (repeat === 'cron') {
      const expr = str(args, 'cron')
      const problem = cronProblem(expr)
      if (problem) throw new ToolError(problem)
      return { kind: 'cron', expr, preset: 'custom' }
    }
    const days = Array.isArray(args.days) ? args.days.filter((d): d is number => typeof d === 'number') : []
    if (repeat === 'selected-days' && !days.length) throw new ToolError('selected-days needs days, e.g. [1, 3, 5].')
    return { kind: 'cron', expr: compileRepeat(repeat, first, timezone, days), preset: repeat }
  }
}
