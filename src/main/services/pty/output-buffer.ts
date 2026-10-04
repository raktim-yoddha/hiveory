/**
 * Bounded scrollback per instance. Offsets are monotonic so the renderer can
 * merge a snapshot with live chunks without duplicates.
 */
export class OutputBuffer {
  private data = ''
  private end = 0

  constructor(private readonly limit = 512 * 1024) {}

  /** Appends output and returns the offset it starts at. */
  append(chunk: string): number {
    const start = this.end
    this.end += chunk.length
    this.data += chunk
    if (this.data.length > this.limit) this.data = this.data.slice(this.data.length - this.limit)
    return start
  }

  snapshot(): { data: string; end: number } {
    return { data: this.data, end: this.end }
  }
}
