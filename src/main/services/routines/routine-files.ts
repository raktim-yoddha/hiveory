import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { ChatAttachment } from '@shared/domain/chat'
import { MAX_ROUTINE_FILE_BYTES } from '@shared/domain/routine'
import { fail } from '@shared/errors'
import { attachmentKind, safeName } from '../chat/chat-service'

/**
 * Files a routine hands every run (ADR 0030): copied into Hiveory's own folder when the user adds
 * them, so a run never depends on the original still being there. A routine may only point at files
 * in this folder: anything else a request names is refused.
 */
export class RoutineFiles {
  constructor(private readonly dir: string) {}

  /** Keeps a copy of a file the user picked in the routine editor. */
  add(name: string, base64: string): ChatAttachment {
    const data = Buffer.from(base64, 'base64')
    if (data.length > MAX_ROUTINE_FILE_BYTES) fail('INVALID_INPUT', `A routine's file can be ${MAX_ROUTINE_FILE_BYTES / 1024 / 1024} MB at most.`)
    mkdirSync(this.dir, { recursive: true })
    const clean = safeName(name)
    const path = join(this.dir, `${randomUUID().slice(0, 8)}-${clean}`)
    writeFileSync(path, data)
    return { name: clean, path, kind: attachmentKind(clean || extname(path)), size: data.length }
  }

  /** Whether a path is one of the copies this folder holds. */
  owns(path: string): boolean {
    return resolve(path).startsWith(resolve(this.dir) + sep)
  }

  /** Deletes copies no routine uses any more (only ones in this folder). */
  remove(paths: string[]): void {
    for (const path of paths) {
      if (!this.owns(path)) continue
      try {
        rmSync(path, { force: true })
      } catch {
        // A leftover copy is harmless.
      }
    }
  }
}
