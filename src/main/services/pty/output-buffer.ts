/**
 * Bounded scrollback per instance. Offsets are monotonic so the renderer can
 * merge a snapshot with live chunks without duplicates.
 */
export class OutputBuffer {
  // Kept as the chunks that arrived: appending never copies what is already held (a flood appends
  // hundreds of times a second), and whole chunks are let go from the front.
  private chunks: string[] = []
  private held = 0
  private end = 0

  constructor(private readonly limit = 512 * 1024) {}

  /** Appends output and returns the offset it starts at. */
  append(chunk: string): number {
    const start = this.end
    this.end += chunk.length
    this.chunks.push(chunk)
    this.held += chunk.length
    let drop = 0
    while (drop < this.chunks.length - 1 && this.held - this.chunks[drop]!.length >= this.limit) this.held -= this.chunks[drop++]!.length
    if (drop) this.chunks.splice(0, drop)
    return start
  }

  /** The newest `limit` characters, and the offset they end at. */
  snapshot(): { data: string; end: number } {
    const data = this.chunks.join('')
    // One string from here on, so repeated snapshots do not join again.
    this.chunks = data ? [data.length > this.limit ? data.slice(data.length - this.limit) : data] : []
    this.held = this.chunks[0]?.length ?? 0
    return { data: this.chunks[0] ?? '', end: this.end }
  }
}
