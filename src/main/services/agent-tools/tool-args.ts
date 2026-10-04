/** A tool failure whose message is shown to the agent as-is, so it can correct itself. */
export class ToolError extends Error {}

export const str = (args: Record<string, unknown>, key: string, required = true): string => {
  const value = args[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (required) throw new ToolError(`Missing required argument "${key}".`)
  return ''
}

export const int = (args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number => {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new ToolError(`"${key}" must be a number.`)
  return Math.min(max, Math.max(min, Math.round(n)))
}
