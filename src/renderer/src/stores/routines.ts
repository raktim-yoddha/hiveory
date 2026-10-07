import { create } from 'zustand'
import type { RoutineRun, RoutineView } from '@shared/domain/routine'
import type { RequestOf } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { reportError, runAction } from './notices'

type RoutineInput = RequestOf<'routines.create'>
type RoutinePatch = Omit<RequestOf<'routines.update'>, 'routineId'>

interface RoutinesState {
  routines: RoutineView[]
  /** The run log, newest first. */
  runs: RoutineRun[]
  loaded: boolean
  load(): Promise<void>
  create(input: RoutineInput): Promise<RoutineView | undefined>
  update(routineId: string, patch: RoutinePatch): Promise<RoutineView | undefined>
  remove(routineId: string): Promise<void>
  runNow(routineId: string): Promise<void>
}

/** Bots' routines and their run log (ADR 0028). Main owns them; this mirrors them for the screens. */
export const useRoutines = create<RoutinesState>((set, get) => ({
  routines: [],
  runs: [],
  loaded: false,

  load: async () => {
    try {
      const [routines, runs] = await Promise.all([api('routines.list', {}), api('routines.runs', {})])
      set({ routines, runs, loaded: true })
    } catch (error) {
      set({ loaded: true })
      reportError(error, 'Load routines')
    }
  },

  create: async (input) => {
    const routine = await runAction('Schedule routine', () => api('routines.create', input))
    if (routine) await get().load()
    return routine
  },

  update: async (routineId, patch) => {
    const routine = await runAction('Save routine', () => api('routines.update', { routineId, ...patch }))
    if (routine) await get().load()
    return routine
  },

  remove: async (routineId) => {
    await runAction('Delete routine', () => api('routines.delete', { routineId }))
    await get().load()
  },

  runNow: async (routineId) => {
    await runAction('Run routine', () => api('routines.runNow', { routineId }))
    await get().load()
  }
}))
