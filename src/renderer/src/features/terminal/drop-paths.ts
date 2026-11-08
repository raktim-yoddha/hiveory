/**
 * Files dropped on a terminal become their paths, typed at the prompt (ADR 0061), as native terminals
 * and the agent CLIs expect: each one quoted for the shell when it needs to be, separated by spaces.
 */
export const quotePath = (path: string, style: 'windows' | 'posix'): string => {
  if (style === 'windows') return /[\s&()[\]{}^=;!'+,`~%$]/.test(path) ? `"${path.replace(/"/g, '')}"` : path
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`
}

/** The text a drop types: quoted paths and a trailing space; '' when no file has a path. */
export const droppedPathsText = (paths: string[], style: 'windows' | 'posix'): string => {
  const shown = paths.filter(Boolean).map((p) => quotePath(p, style))
  return shown.length ? `${shown.join(' ')} ` : ''
}
