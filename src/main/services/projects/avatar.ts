import { extname } from 'node:path'
import { fail } from '@shared/errors'
import { AVATAR_PX } from '@shared/domain/project'

/** An image as Electron's nativeImage gives it, narrowed to what an avatar needs (a stand-in in tests). */
export interface AvatarImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  crop(rect: { x: number; y: number; width: number; height: number }): AvatarImage
  resize(options: { width: number; height: number; quality?: 'good' | 'better' | 'best' }): AvatarImage
  toPNG(): Buffer
}

export interface AvatarCodec {
  createFromPath(path: string): AvatarImage
  createFromBuffer(buffer: Buffer): AvatarImage
}

export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg']

/** An image's centre square, scaled to AVATAR_PX, as a PNG data URL small enough to keep in settings. */
export const avatarFromImage = (image: AvatarImage): string => {
  if (image.isEmpty()) fail('INVALID_INPUT', 'That image could not be read.')
  const { width, height } = image.getSize()
  const side = Math.min(width, height)
  const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  return `data:image/png;base64,${square.resize({ width: AVATAR_PX, height: AVATAR_PX, quality: 'best' }).toPNG().toString('base64')}`
}

/** A Workspace avatar from an image file the user chose (ADR 0042). */
export const avatarFromFile = (path: string, codec: AvatarCodec): string => {
  if (!AVATAR_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) fail('INVALID_INPUT', 'Choose a PNG or JPEG image.')
  return avatarFromImage(codec.createFromPath(path))
}

/** GitHub logins: letters, digits and single hyphens, up to 39 characters. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/

/** A GitHub account's avatar as a Workspace avatar (ADR 0043), from GitHub's public avatar address. */
export const avatarFromGithub = async (login: string, codec: AvatarCodec, http: typeof fetch = fetch): Promise<string> => {
  if (!GITHUB_LOGIN.test(login)) fail('INVALID_INPUT', 'That is not a GitHub account name.')
  let response: Response
  try {
    response = await http(`https://github.com/${login}.png?size=192`, { signal: AbortSignal.timeout(15_000) })
  } catch {
    return fail('INVALID_INPUT', 'Could not reach GitHub.', { hint: 'Check your connection and try again.' })
  }
  if (!response.ok) fail('NOT_FOUND', `GitHub has no avatar for ${login}.`)
  return avatarFromImage(codec.createFromBuffer(Buffer.from(await response.arrayBuffer())))
}
