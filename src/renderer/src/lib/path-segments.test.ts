import { describe, expect, it } from 'vitest'
import { pathSegments } from './path-segments'

describe('path trail segments', () => {
  it('collapses home folders on every platform', () => {
    expect(pathSegments('C:\\Users\\rakti\\Downloads\\ade-starter-docs')).toEqual({ home: true, parts: ['Downloads', 'ade-starter-docs'] })
    expect(pathSegments('/home/me/code/app')).toEqual({ home: true, parts: ['code', 'app'] })
    expect(pathSegments('/Users/me/app')).toEqual({ home: true, parts: ['app'] })
  })

  it('keeps other paths whole', () => {
    expect(pathSegments('D:\\work\\repo')).toEqual({ home: false, parts: ['D:', 'work', 'repo'] })
    expect(pathSegments('C:\\Users\\me')).toEqual({ home: false, parts: ['C:', 'Users', 'me'] })
    expect(pathSegments('')).toEqual({ home: false, parts: [] })
  })
})
