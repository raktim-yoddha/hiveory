import { extname } from 'node:path'
import { fail } from '@shared/errors'
import { AVATAR_PX } from '@shared/domain/project'

/** Electron's nativeImage, narrowed to what an avatar needs (a stand-in in tests). */
export interface AvatarCodec {
  createFromPath(path: string): {
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    crop(rect: { x: number; y: number; width: number; height: number }): ReturnType<AvatarCodec['createFromPath']>
    resize(options: { width: number; height: number; quality?: 'good' | 'better' | 'best' }): ReturnType<AvatarCodec['createFromPath']>
    toPNG(): Buffer
  }
}

export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg']

/**
 * A Workspace avatar from an image file (ADR 0042): its centre square, scaled to AVATAR_PX, as a PNG
 * data URL small enough to keep in the Workspace's settings (and send to the phone).
 */
export const avatarFromFile = (path: string, codec: AvatarCodec): string => {
  if (!AVATAR_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) fail('INVALID_INPUT', 'Choose a PNG or JPEG image.')
  const image = codec.createFromPath(path)
  if (image.isEmpty()) fail('INVALID_INPUT', 'That image could not be read.')
  const { width, height } = image.getSize()
  const side = Math.min(width, height)
  const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  return `data:image/png;base64,${square.resize({ width: AVATAR_PX, height: AVATAR_PX, quality: 'best' }).toPNG().toString('base64')}`
}
