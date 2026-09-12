import { describe, expect, it } from 'vitest'
import { createLatestAsyncQueue } from './latest-async-queue'

describe('latest async queue', () => {
  it('runs the active value and only the latest pending value', async () => {
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const calls: number[] = []
    const queue = createLatestAsyncQueue(async (value: number) => {
      calls.push(value)
      if (value === 1) await firstGate
      return value
    })

    const first = queue.enqueue(1)
    const superseded = queue.enqueue(2)
    const latest = queue.enqueue(3)
    releaseFirst()

    await expect(first).resolves.toBe(1)
    await expect(superseded).resolves.toBe(3)
    await expect(latest).resolves.toBe(3)
    expect(calls).toEqual([1, 3])
  })
})
