/** Joins truthy class names. */
export const cx = (...names: Array<string | false | null | undefined>): string => names.filter(Boolean).join(' ')
