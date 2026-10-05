import { describe, expect, it } from 'vitest'
import { pathSegments } from './path-segments'

describe('path trail segments', () => {
  it('collapses home folders on every platform', () => {
    expect(pathSegments('C:\\Users\\alex\\Downloads\\ade-starter-docs')).toEqual({ root: 'home', parts: ['Downloads', 'ade-starter-docs'] })
    expect(pathSegments('/home/me/code/app')).toEqual({ root: 'home', parts: ['code', 'app'] })
    expect(pathSegments('/Users/me/app')).toEqual({ root: 'home', parts: ['app'] })
  })

  it('shows Hiveory-managed workspaces as project › workspace', () => {
    expect(pathSegments('C:\\Users\\alex\\AppData\\Local\\Hiveory Dev\\Workspaces\\ade-starter-docs-d5bc53\\quiet-marsh')).toEqual({
      root: 'workspaces',
      parts: ['ade-starter-docs', 'quiet-marsh']
    })
    expect(pathSegments('/home/me/.local/share/Hiveory/Workspaces/app-a1b2c3/amber/packages/web')).toEqual({
      root: 'workspaces',
      parts: ['app', 'amber', 'packages', 'web']
    })
  })

  it('keeps other paths whole', () => {
    expect(pathSegments('D:\\work\\repo')).toEqual({ root: null, parts: ['D:', 'work', 'repo'] })
    expect(pathSegments('C:\\Users\\me')).toEqual({ root: null, parts: ['C:', 'Users', 'me'] })
    expect(pathSegments('D:\\Workspaces\\x\\y')).toEqual({ root: null, parts: ['D:', 'Workspaces', 'x', 'y'] })
    expect(pathSegments('')).toEqual({ root: null, parts: [] })
  })
})
