import { MAX_SCRIPTS, SCRIPT_NAME, scriptCommandProblem, type WorkspaceScript } from '@shared/domain'

/** Why a new script can't be added yet, or null (ADR 0061). */
export const scriptProblem = (name: string, command: string, existing: WorkspaceScript[]): string | null => {
  if (!SCRIPT_NAME.test(name)) return 'Name it with letters and digits (spaces, . _ : - inside), up to 40 characters.'
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) return 'A script already has that name.'
  if (existing.length >= MAX_SCRIPTS) return `A Workspace keeps up to ${MAX_SCRIPTS} scripts.`
  return scriptCommandProblem(command)
}
