import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AppPaths {
  stateFile: string
  /** One JSON file per chat. */
  chatsDir: string
  logDir: string
  /** Generated per-instance files such as hook settings. */
  runtimeDir: string
  /** Root of isolated Workspace worktrees: <root>/<project>/<workspace>. */
  worktreeRoot: string
}

/**
 * Machine-local data root (ADR 0008). Worktrees are large and machine-specific,
 * so on Windows they go to LocalAppData rather than the roaming profile.
 */
export const resolvePaths = (userData: string, appName: string, env = process.env): AppPaths => {
  const dataRoot =
    process.platform === 'win32'
      ? join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), appName)
      : process.platform === 'darwin'
        ? userData
        : join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), appName.toLowerCase().replace(/\s+/g, '-'))
  return {
    stateFile: join(userData, 'state.json'),
    chatsDir: join(userData, 'chats'),
    logDir: join(userData, 'logs'),
    runtimeDir: join(dataRoot, 'Runtime'),
    worktreeRoot: join(dataRoot, 'Workspaces')
  }
}
