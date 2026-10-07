import { randomUUID } from 'node:crypto'
import { GENERAL_TEAM, MAX_TEAM_NAME, oneChiefPerTeam, type Team } from '@shared/domain/bot'
import { fail } from '@shared/errors'
import type { Emit } from '../events'
import { nowIso } from '../events'
import type { StateStore } from '../persistence/state-store'

/**
 * Bots' teams (ADR 0028): named groups, each with its own Chief of Staff. General always exists and
 * can be renamed, never deleted. Deleting a team moves its bots to General, never deletes them.
 */
export class TeamService {
  constructor(
    private readonly store: StateStore,
    private readonly emit: Emit,
    /** Whether a bot has a conversation going: a team is never deleted out from under running work. */
    private readonly busy: (botId: string) => boolean
  ) {}

  list(): Team[] {
    return this.store.state.teams.map((t) => ({ ...t }))
  }

  create(name: string): Team {
    const team: Team = { id: randomUUID(), name: this.cleanName(name), createdAt: nowIso() }
    this.store.update((s) => {
      s.teams.push(team)
    })
    this.changed()
    return team
  }

  rename(teamId: string, name: string): Team {
    this.get(teamId)
    const clean = this.cleanName(name, teamId)
    this.store.update((s) => {
      const team = s.teams.find((t) => t.id === teamId)
      if (team) team.name = clean
    })
    this.changed()
    return this.get(teamId)
  }

  delete(teamId: string): void {
    const team = this.get(teamId)
    if (team.id === GENERAL_TEAM.id) fail('INVALID_INPUT', `${team.name} can't be deleted: bots without a team live there.`)
    const members = this.store.state.bots.filter((b) => b.teamId === teamId)
    if (members.some((b) => this.busy(b.id))) fail('INVALID_INPUT', `Stop ${team.name}'s running work before deleting the team.`)
    this.store.update((s) => {
      // General keeps its own Chief; a Chief moving in from the deleted team steps down.
      const generalLed = s.bots.some((b) => b.chief && b.teamId === GENERAL_TEAM.id)
      for (const b of s.bots) {
        if (b.teamId !== teamId) continue
        b.teamId = GENERAL_TEAM.id
        if (generalLed) b.chief = false
      }
      s.bots = oneChiefPerTeam(s.bots)
      s.teams = s.teams.filter((t) => t.id !== teamId)
    })
    this.changed()
  }

  private get(teamId: string): Team {
    return this.store.state.teams.find((t) => t.id === teamId) ?? fail('NOT_FOUND', 'Team not found.')
  }

  private cleanName(name: string, exceptId?: string): string {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean || clean.length > MAX_TEAM_NAME) fail('INVALID_INPUT', `Give the team a name of 1 to ${MAX_TEAM_NAME} characters.`)
    if (this.store.state.teams.some((t) => t.id !== exceptId && t.name.toLowerCase() === clean.toLowerCase())) {
      fail('INVALID_INPUT', `There is already a team called ${clean}.`)
    }
    return clean
  }

  private changed(): void {
    this.emit('state.changed', { topic: 'bots' })
  }
}
