import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_NAMES, IPC_PREFIX, type Channel, type EventName } from '@shared/ipc/contract'
import type { HiveoryApi } from './api'

const channels = new Set<string>(CHANNELS)
const events = new Set<string>(EVENT_NAMES)

/**
 * The renderer's only bridge to the system: a whitelist of contract channels.
 * Raw ipcRenderer, Node and shell APIs are never exposed (AGENTS.md rule 4).
 */
const api: HiveoryApi = {
  invoke: (channel: Channel, payload?: unknown) => {
    if (!channels.has(channel)) return Promise.reject(new Error(`Unknown channel ${String(channel)}`))
    return ipcRenderer.invoke(IPC_PREFIX + channel, payload)
  },
  on: (event: EventName, listener: (payload: unknown) => void) => {
    if (!events.has(event)) throw new Error(`Unknown event ${String(event)}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(IPC_PREFIX + event, wrapped)
    return () => ipcRenderer.removeListener(IPC_PREFIX + event, wrapped)
  },
  // The on-disk path of a file the user dropped or pasted (no file contents cross the bridge).
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
} as HiveoryApi

contextBridge.exposeInMainWorld('hiveory', api)
