import { expect, test } from 'vitest'
import { resolveHiveoryEdition } from './edition'

test('recognizes only the explicit Dev edition', () => {
  expect(resolveHiveoryEdition('dev')).toBe('dev')
  expect(resolveHiveoryEdition('production')).toBe('production')
  expect(resolveHiveoryEdition(undefined)).toBe('production')
})
