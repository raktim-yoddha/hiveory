import { describe, expect, it } from 'vitest'
import { AVATAR_DATA } from '@shared/domain/project'
import { parseState } from '../persistence/schema'
import { avatarFromFile, avatarFromGithub, type AvatarCodec } from './avatar'

describe('workspace avatars', () => {
  it('keeps the centre square of an image, scaled down, as a PNG data URL', () => {
    const calls: string[] = []
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 400, height: 200 }),
      crop: (r: { x: number; y: number; width: number; height: number }) => (calls.push(`crop ${r.x},${r.y} ${r.width}x${r.height}`), image),
      resize: (o: { width: number; height: number }) => (calls.push(`resize ${o.width}x${o.height}`), image),
      toPNG: () => Buffer.from('png')
    }
    const codec = { createFromPath: () => image } as unknown as AvatarCodec
    const url = avatarFromFile('/home/me/me.jpg', codec)
    expect(calls).toEqual(['crop 100,0 200x200', 'resize 96x96'])
    expect(url).toMatch(AVATAR_DATA)
    expect(() => avatarFromFile('/home/me/me.gif', codec)).toThrow('PNG or JPEG')
  })

  it("fetches a GitHub account's avatar from its public address, refusing odd names", async () => {
    const urls: string[] = []
    const image = { isEmpty: () => false, getSize: () => ({ width: 200, height: 200 }), crop: () => image, resize: () => image, toPNG: () => Buffer.from('png') }
    const codec = { createFromBuffer: () => image } as unknown as AvatarCodec
    const http = (async (url: string) => (urls.push(url), new Response('img'))) as unknown as typeof fetch
    expect(await avatarFromGithub('acme-labs', codec, http)).toMatch(/^data:image\/png;base64,/)
    expect(urls).toEqual(['https://github.com/acme-labs.png?size=192'])
    await expect(avatarFromGithub('../../evil', codec, http)).rejects.toThrow('not a GitHub account')
  })

  it('stores an emoji mark, dropping text that is not one', () => {
    const project = { id: 'p', name: 'web', path: '/home/me/web', createdAt: 'x', updatedAt: 'x', lastOpenedAt: 'x' }
    expect(parseState({ projects: [{ ...project, settings: { emoji: '🚀' } }] }).state.projects[0]?.settings).toEqual({ emoji: '🚀' })
    expect(parseState({ projects: [{ ...project, settings: { emoji: '👩‍💻' } }] }).state.projects[0]?.settings).toEqual({ emoji: '👩‍💻' })
    expect(parseState({ projects: [{ ...project, settings: { emoji: 'hello', alerts: false } }] }).state.projects[0]?.settings).toEqual({ alerts: false })
  })

  it('stores an avatar and a custom color, dropping malformed ones', () => {
    const project = { id: 'p', name: 'web', path: '/home/me/web', createdAt: 'x', updatedAt: 'x', lastOpenedAt: 'x' }
    const good = { avatar: 'data:image/png;base64,cG5n', customColor: '#12abef' }
    expect(parseState({ projects: [{ ...project, settings: good }] }).state.projects[0]?.settings).toEqual(good)
    const bad = parseState({ projects: [{ ...project, settings: { avatar: 'https://x/y.png', customColor: 'red', alerts: false } }] }).state.projects[0]?.settings
    expect(bad).toEqual({ alerts: false })
  })
})
