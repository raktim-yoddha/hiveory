import type { AppSettings } from '../domain/settings'
import { PET_NAMES } from '../naming/names'
import type { QueenReport } from './report'
import { formatWait } from './report'

export type PersonaId = 'ada' | 'sunny' | 'frankie' | 'custom'
/** The three fixed cores. A custom personality borrows the phrasing of the one its sliders lean to. */
export type PersonaCore = Exclude<PersonaId, 'custom'>

export const PERSONAS: Record<PersonaId, { name: string; tagline: string; placeholder: string }> = {
  ada: { name: 'Ada', tagline: 'Strict, formal and precise', placeholder: 'Your instructions' },
  sunny: { name: 'Sunny', tagline: 'Fun and full of energy', placeholder: 'What are we building?' },
  frankie: { name: 'Frankie', tagline: 'Frank facts, then a push forward', placeholder: "What's the next move?" },
  custom: { name: 'Custom', tagline: 'Your own name, style and voice', placeholder: 'What do you need?' }
}

/** Reserved: never used as agent pet names, so "tell Ada…" is never ambiguous. */
export const PERSONA_NAMES = [PERSONAS.ada.name, PERSONAS.sunny.name, PERSONAS.frankie.name]

/** Why a custom name can't be used, or null. Agent pet names are refused so "tell Max…" stays unambiguous. */
export function customNameProblem(name: string): string | null {
  const n = name.trim()
  if (!/^\p{L}[\p{L}' -]{0,19}$/u.test(n)) return 'Use 1–20 letters.'
  const lower = n.toLowerCase()
  if (['queen', 'queen bee', 'bee'].includes(lower)) return 'That name is taken by Queen Bee herself.'
  if (PERSONA_NAMES.some((x) => x.toLowerCase() === lower)) return `${n} is one of the built-in personalities.`
  if (PET_NAMES.some((x) => x.toLowerCase() === lower)) return `${n} is an agent name. Pick another so “tell ${n}…” stays clear.`
  return null
}

/** Her name, tagline and placeholder, plus the user's own persona text (custom only). */
export function personaInfo(s: Pick<AppSettings, 'queenPersona' | 'queenCustomName' | 'queenCustomPersona'>): { name: string; tagline: string; placeholder: string; text?: string } {
  const base = PERSONAS[s.queenPersona]
  if (s.queenPersona !== 'custom') return base
  const text = s.queenCustomPersona.trim().slice(0, 500)
  return { ...base, name: s.queenCustomName || 'Zara', ...(text ? { text } : {}) }
}

/** The user's Queen Bee preferences (Settings › Queen Bee). */
export interface QueenPrefs {
  persona: PersonaId
  /** What she calls you ('' = nothing). */
  callMe: string
  /** Ada: how she addresses you. */
  honorific: 'sir' | 'maam' | 'name' | 'none'
  /** Sunny: how loud the celebration is. */
  hype: 'calm' | 'lively' | 'max'
  /** Frankie: minutes an agent may wait on you before she calls it out (0 = never). */
  nudgeMinutes: number
  /** Short drops the second sentence of every reply. */
  length: 'short' | 'normal'
  /** Frankie: the goal she keeps you honest about. */
  goal?: string
  /** Frankie: how hard she pushes. */
  intensity?: 'steady' | 'hard'
  /** Custom: slider positions, 0–100. */
  custom?: { formal: number; energy: number; direct: number }
}

/** The preferences stored in settings, as the phrasing functions read them. */
export const prefsFromSettings = (s: AppSettings): QueenPrefs => ({
  persona: s.queenPersona,
  callMe: s.queenCallMe,
  honorific: s.queenHonorific,
  hype: s.queenHype,
  nudgeMinutes: s.queenNudgeMinutes,
  length: s.queenLength,
  goal: s.queenGoal,
  intensity: s.queenIntensity,
  custom: { formal: s.queenCustomFormal, energy: s.queenCustomEnergy, direct: s.queenCustomDirect }
})

/**
 * Which core's phrasing a custom personality uses: the slider pushed furthest
 * wins (formal → Ada, energetic → Sunny, direct → Frankie). All three on the soft
 * side (casual, calm, gentle) reads as a calm Sunny. Her energy sets Sunny's hype.
 */
export function personaCore(p: QueenPrefs): PersonaCore {
  if (p.persona !== 'custom') return p.persona
  const { formal, energy, direct } = p.custom ?? { formal: 50, energy: 50, direct: 50 }
  const top = Math.max(formal, energy, direct)
  if (top <= 50) return 'sunny'
  return direct === top ? 'frankie' : formal === top ? 'ada' : 'sunny'
}

type CorePrefs = QueenPrefs & { persona: PersonaCore }

/** The fixed-core preferences the phrasing functions switch on. */
const effective = (p: QueenPrefs): CorePrefs => {
  if (p.persona !== 'custom') return p as CorePrefs
  const energy = p.custom?.energy ?? 50
  return { ...p, persona: personaCore(p), hype: energy < 34 ? 'calm' : energy < 67 ? 'lively' : 'max' }
}

/** What actually happened, from the executor. Receipts and persona lines are both built from these. */
export type QueenOutcome =
  | { kind: 'opened'; count: number; cliName: string; workspace: string }
  | { kind: 'closed'; names: string[] }
  | { kind: 'restarted'; name: string }
  | { kind: 'focused'; name: string }
  | { kind: 'messaged'; name: string }
  | { kind: 'navigated'; place: string }
  | { kind: 'mode'; mode: 'Work' | 'Chat' }
  | { kind: 'preset'; name: string; workspace: string }
  | { kind: 'panel'; what: 'side panel' | 'side panel closed' | 'browser' | 'explorer' }
  | { kind: 'noted'; text: string }
  | { kind: 'forgot'; count: number }

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many)
const list = (names: string[]): string => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** A neutral, persona-free line per outcome: shown as the receipt under the reply. */
export function receipt(o: QueenOutcome): string {
  switch (o.kind) {
    case 'opened':
      return `Opened ${o.count} ${o.cliName} in ${o.workspace}`
    case 'closed':
      return `Closed ${list(o.names)}`
    case 'restarted':
      return `Restarted ${o.name}`
    case 'focused':
      return `Showing ${o.name}`
    case 'messaged':
      return `Sent to ${o.name}`
    case 'navigated':
      return `Opened ${o.place}`
    case 'mode':
      return `Switched to ${o.mode}`
    case 'preset':
      return `Loaded ${o.name} in ${o.workspace}`
    case 'panel':
      return o.what === 'side panel' ? 'Opened the side panel' : o.what === 'side panel closed' ? 'Closed the side panel' : `Opened the ${o.what === 'browser' ? 'browser' : 'Explorer'}`
    case 'noted':
      return `Noted: ${o.text}`
    case 'forgot':
      return `Forgot ${o.count} ${plural(o.count, 'note')}`
  }
}

/** The main fact of a batch, in a sentence. Ada spells small numbers out. */
const summary = (o: QueenOutcome, formal: boolean): string => {
  const n = (count: number) => (formal && count < 10 ? WORDS[count]! : String(count))
  switch (o.kind) {
    case 'opened':
      return `${n(o.count)} ${o.cliName} ${plural(o.count, 'agent is', 'agents are')} starting in ${o.workspace}`
    case 'closed':
      return `${list(o.names)} ${plural(o.names.length, 'is', 'are')} closed`
    case 'restarted':
      return `${o.name} is restarting`
    case 'focused':
      return `here is ${o.name}`
    case 'messaged':
      return `${o.name} has your message`
    case 'navigated':
      return `${o.place} is open`
    case 'mode':
      return `you're in ${o.mode}`
    case 'preset':
      return `${o.name} is loading in ${o.workspace}`
    case 'panel':
      return o.what === 'side panel closed' ? 'the side panel is closed' : `the ${o.what === 'side panel' ? 'side panel' : o.what === 'browser' ? 'browser' : 'Explorer'} is open`
    case 'noted':
      return "I'll remember that"
    case 'forgot':
      return `${o.count} ${plural(o.count, 'note is', 'notes are')} gone`
  }
}

const address = (p: QueenPrefs): string =>
  p.honorific === 'sir' ? ', sir' : p.honorific === 'maam' ? ", ma'am" : p.honorific === 'name' && p.callMe ? `, ${p.callMe}` : ''

const finish = (sentences: string[], p: QueenPrefs): string => (p.length === 'short' ? sentences.slice(0, 1) : sentences).filter(Boolean).join(' ')

/** The persona's one-line reply after actions ran. */
export function doneLine(outcomes: QueenOutcome[], prefs: QueenPrefs): string {
  const p = effective(prefs)
  const first = outcomes[0]
  if (!first) return ''
  const more = outcomes.length - 1
  const extra = more ? `, plus ${more} more ${plural(more, 'step')}` : ''
  switch (p.persona) {
    case 'ada':
      return finish([`Done${address(p)}.`, `${cap(summary(first, true))}${extra}.`], p)
    case 'sunny': {
      const lead = p.hype === 'max' ? "Let's go!" : p.hype === 'calm' ? 'Done.' : 'On it!'
      return finish([lead, `${cap(summary(first, false))}${extra}${p.hype === 'max' ? '!' : '.'}`], p)
    }
    case 'frankie': {
      const hard = p.intensity === 'hard'
      const push =
        first.kind === 'opened'
          ? hard
            ? 'One clear task each, right now. No vague prompts.'
            : 'Give each one a single clear task.'
          : first.kind === 'closed'
            ? 'Fewer agents, sharper focus.'
            : first.kind === 'messaged'
              ? hard
                ? 'Now let it work. Stop hovering.'
                : 'Now let it work.'
              : ''
      return finish([`${cap(summary(first, false))}${extra}.`, push], p)
    }
  }
}

/** The persona's reading of a computed report. Every number comes from the report. */
export function reportLine(r: QueenReport, prefs: QueenPrefs): string {
  const p = effective(prefs)
  const goal = p.goal?.trim() ? `Goal: ${p.goal.trim().replace(/[.!]+$/, '')}.` : ''
  const hard = p.intensity === 'hard'
  const top = r.waiting[0]
  const waitText = top?.waitingMinutes !== undefined ? ` for ${formatWait(top.waitingMinutes)}` : ''
  const name = p.callMe ? `${p.callMe}, ` : ''
  if (r.total === 0) {
    return { ada: `There are no agents in this project${address(p)}.`, sunny: 'No agents yet. Open a few and let the hive buzz!', frankie: 'No agents running. Nothing ships by itself.' }[p.persona]
  }
  if (r.focus === 'waiting-for-you' && !r.waiting.length) {
    return { ada: `No agent is waiting for you${address(p)}.`, sunny: "Nobody's waiting on you. All clear!", frankie: "Nothing's blocked on you. No excuses, then." }[p.persona]
  }
  const counts = `${r.counts['waiting-for-you']} waiting for you, ${r.counts.working} working, ${r.counts.idle} idle`
  switch (p.persona) {
    case 'ada':
      return finish([`${cap(counts)}${address(p)}.`, top ? `${top.petName} in ${top.workspaceName} has been waiting${waitText}.` : ''], p)
    case 'sunny':
      return finish([
        `${p.callMe ? `Hey ${p.callMe}! ` : ''}${r.counts.working} buzzing, ${r.counts['waiting-for-you']} need you, ${r.counts.idle} chilling.`,
        top ? `${top.petName} has been waiting${waitText}. Go say hi!` : r.counts.working ? 'The hive is humming!' : ''
      ], p)
    case 'frankie': {
      const overdue = top && p.nudgeMinutes > 0 && (top.waitingMinutes ?? 0) >= p.nudgeMinutes
      if (top) {
        return finish([
          `${name}${top.petName} has waited on you${waitText}.`,
          overdue
            ? hard
              ? "You're the bottleneck. Every minute it waits, nothing ships."
              : "That's the bottleneck, not the agents. Answer it and the hive moves again."
            : `Answer it, then check the other ${r.total - 1}.`,
          goal
        ], p)
      }
      if (r.counts.working) return finish([`${cap(counts)}.`, 'Nothing is blocked on you. Plan the next task while they work.', goal], p)
      return finish([`${r.counts.idle} ${plural(r.counts.idle, 'agent')} idle.`, hard ? 'Idle agents ship nothing. Give them work now.' : 'Idle agents ship nothing. Give them work.', goal], p)
    }
  }
}

export function unknownLine(prefs: QueenPrefs): string {
  const p = effective(prefs)
  return {
    ada: `That is outside what I can do yet${address(p)}. I open, close and find agents, switch pages and report status.`,
    sunny: "That one's beyond me for now! Try “open two Codex” or “what's left?”",
    frankie: "I don't do that yet. I run agents, switch pages and tell you where things stand."
  }[p.persona]
}

export function cancelledLine(prefs: QueenPrefs): string {
  const p = effective(prefs)
  return { ada: `Understood${address(p)}. Nothing was changed.`, sunny: 'No worries, nothing changed!', frankie: 'Cancelled. Nothing changed.' }[p.persona]
}

export function failedLine(error: string, prefs: QueenPrefs): string {
  const p = effective(prefs)
  return { ada: `That did not work${address(p)}: ${error}`, sunny: `Oops, that didn't work: ${error}`, frankie: `Failed: ${error}` }[p.persona]
}

export function undoneLine(prefs: QueenPrefs): string {
  const p = effective(prefs)
  return { ada: `Reverted${address(p)}.`, sunny: 'Undone, like it never happened!', frankie: 'Undone.' }[p.persona]
}

/** Her notes, read back. */
export function recallLine(notes: string[], prefs: QueenPrefs): string {
  const p = effective(prefs)
  if (!notes.length) {
    return {
      ada: `I have no notes yet${address(p)}. Say “remember that …” and I will keep it.`,
      sunny: 'Nothing yet! Say “remember that …” and I’ll hold on to it.',
      frankie: 'No notes. Tell me “remember that …” if something matters.'
    }[p.persona]
  }
  const lead = { ada: `I have ${notes.length} ${plural(notes.length, 'note')}${address(p)}:`, sunny: "Here's what I know!", frankie: `${notes.length} ${plural(notes.length, 'note')}:` }[p.persona]
  return `${lead} ${notes.map((n) => n.replace(/[.!]+$/, '')).join('; ')}.`
}

/** Nothing matched a "forget …". */
export function nothingToForgetLine(prefs: QueenPrefs): string {
  const p = effective(prefs)
  return { ada: `I have no note about that${address(p)}.`, sunny: "I don't have a note like that!", frankie: 'No note matches that.' }[p.persona]
}
