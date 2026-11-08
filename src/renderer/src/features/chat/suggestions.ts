/**
 * What the composer suggests as you type (ADR 0058): `@` anywhere tags a file of the worktree, `/` at
 * the start of the message picks one of the CLI's slash commands or skills (CLIs only run a command
 * that starts the message).
 */
export interface Trigger {
  kind: '@' | '/'
  /** What follows the trigger character, up to the caret. */
  query: string
  /** Where the trigger character is. */
  start: number
}

export const findTrigger = (text: string, caret: number): Trigger | null => {
  const before = text.slice(0, caret)
  const command = /^\/([\w:.-]*)$/.exec(before)
  if (command) return { kind: '/', query: command[1] ?? '', start: 0 }
  const mention = /(^|\s)@([^\s@]*)$/.exec(before)
  if (mention) return { kind: '@', query: mention[2] ?? '', start: before.length - (mention[2]?.length ?? 0) - 1 }
  return null
}

/** The text with the trigger's token replaced by `value` and a space; the caret goes after it. */
export const applySuggestion = (text: string, caret: number, trigger: Trigger, value: string): { text: string; caret: number } => {
  const inserted = `${trigger.kind}${value} `
  const after = text.slice(caret).replace(/^\S*/, '')
  return { text: text.slice(0, trigger.start) + inserted + after.replace(/^ /, ''), caret: trigger.start + inserted.length }
}
