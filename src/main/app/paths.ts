import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AppPaths {
  stateFile: string
  /** One JSON file per chat. */
  chatsDir: string
  /** Each bot's own working folder: <botsDir>/<bot id>. */
  botsDir: string
  logDir: string
  /** Generated per-instance files such as hook settings. */
  runtimeDir: string
  /** Root of isolated Workspace worktrees: <root>/<project>/<workspace>. */
  worktreeRoot: string
  /** Copies of the wallpapers the user added. */
  wallpapersDir: string
  /** Installed VS Code color themes, as Hiveory tokens (ADR 0034). */
  themesDir: string
  /** Queen Bee's speech packs (large, machine-local). */
  voiceDir: string
  /** Set when this desktop uses a Hiveory server (ADR 0022): how to reach it, token sealed. */
  clientFile: string
  /** Devices paired with this machine when it runs as a Hiveory server (token hashes only). */
  serverDevicesFile: string
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
    botsDir: join(dataRoot, 'Bots'),
    logDir: join(userData, 'logs'),
    runtimeDir: join(dataRoot, 'Runtime'),
    worktreeRoot: join(dataRoot, 'Workspaces'),
    wallpapersDir: join(userData, 'wallpapers'),
    themesDir: join(userData, 'themes'),
    voiceDir: join(dataRoot, 'Voice'),
    clientFile: join(userData, 'client.json'),
    serverDevicesFile: join(userData, 'server-devices.json')
  }
}
