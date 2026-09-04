import { expect, test } from 'vitest'
import { getSplitMenuPosition } from './CodeSplitPanePicker.utils'

test('keeps the split picker inside the viewport and opens above when needed', () => {
  const below = getSplitMenuPosition(
    { top: 24, right: 390, bottom: 56 },
    { innerWidth: 420, innerHeight: 900 },
  )
  expect(below.left).toBeGreaterThanOrEqual(12)
  expect(below.left + below.width).toBeLessThanOrEqual(408)
  expect(below.above).toBe(false)

  const above = getSplitMenuPosition(
    { top: 820, right: 410, bottom: 852 },
    { innerWidth: 420, innerHeight: 900 },
  )
  expect(above.above).toBe(true)
  expect(above.top).toBeLessThanOrEqual(820)
  expect(above.maxHeight).toBeLessThanOrEqual(876)
})
