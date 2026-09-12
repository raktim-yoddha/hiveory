export interface LatestAsyncQueue<T, R> {
  enqueue(value: T): Promise<R>
}

export function createLatestAsyncQueue<T, R>(worker: (value: T) => Promise<R>): LatestAsyncQueue<T, R> {
  type Waiter = { resolve: (value: R) => void; reject: (reason: unknown) => void }
  let pending: { value: T; waiters: Waiter[] } | null = null
  let running = false

  const drain = async () => {
    if (running) return
    running = true
    try {
      while (pending) {
        const current = pending
        pending = null
        try {
          const result = await worker(current.value)
          current.waiters.forEach((waiter) => waiter.resolve(result))
        } catch (error) {
          current.waiters.forEach((waiter) => waiter.reject(error))
        }
      }
    } finally {
      running = false
      if (pending) void drain()
    }
  }

  return {
    enqueue(value: T): Promise<R> {
      return new Promise((resolve, reject) => {
        if (pending) {
          pending.value = value
          pending.waiters.push({ resolve, reject })
        } else {
          pending = { value, waiters: [{ resolve, reject }] }
        }
        void drain()
      })
    },
  }
}
