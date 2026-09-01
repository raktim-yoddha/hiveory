export type HiveoryEdition = 'production' | 'dev'

export function resolveHiveoryEdition(value: unknown): HiveoryEdition {
  return value === 'dev' ? 'dev' : 'production'
}

export const hiveoryEdition = resolveHiveoryEdition(import.meta.env.VITE_HIVEORY_EDITION)
export const isHiveoryDev = hiveoryEdition === 'dev'
