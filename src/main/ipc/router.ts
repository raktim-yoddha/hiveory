import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { toAppError, type Result } from '@shared/errors'
import { CHANNELS, IPC_PREFIX, requestSchemas, type Channel, type ResponseOf } from '@shared/ipc/contract'
import type { Logger } from '../app/logger'

export type Handlers = {
  [C in Channel]: (
    input: z.output<(typeof requestSchemas)[C]>,
    event: IpcMainInvokeEvent
  ) => Promise<ResponseOf<C>> | ResponseOf<C>
}

/**
 * Registers every contract channel. Each call is sender-checked, schema-
 * validated and wrapped so a failing handler returns an error instead of
 * breaking the app.
 */
export const registerIpc = (handlers: Handlers, isTrusted: (event: IpcMainInvokeEvent) => boolean, log: Logger): void => {
  for (const channel of CHANNELS) {
    ipcMain.handle(IPC_PREFIX + channel, async (event, payload: unknown): Promise<Result<unknown>> => {
      if (!isTrusted(event)) {
        log.warn(`Rejected IPC ${channel} from untrusted sender ${event.senderFrame?.url}`)
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Request rejected.' } }
      }
      const parsed = requestSchemas[channel].safeParse(payload)
      if (!parsed.success) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid request.', detail: parsed.error.message } }
      }
      try {
        const handler = handlers[channel] as (input: unknown, event: IpcMainInvokeEvent) => unknown
        return { ok: true, value: await handler(parsed.data, event) }
      } catch (error) {
        const appError = toAppError(error)
        if (appError.code === 'UNEXPECTED') log.error(`IPC ${channel} failed`, error)
        return { ok: false, error: appError }
      }
    })
  }
}
