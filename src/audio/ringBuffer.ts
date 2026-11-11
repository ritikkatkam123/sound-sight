/** Fixed-size buffer that keeps the most recent `capacity` samples. */
export class RingBuffer {
  readonly capacity: number
  private readonly data: Float32Array
  private write = 0
  private filled = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.data = new Float32Array(capacity)
  }

  get length(): number {
    return this.filled
  }

  push(chunk: Float32Array): void {
    // Only the tail of an oversized chunk can survive anyway.
    const src = chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk
    const first = Math.min(src.length, this.capacity - this.write)
    this.data.set(src.subarray(0, first), this.write)
    this.data.set(src.subarray(first), 0)
    this.write = (this.write + src.length) % this.capacity
    this.filled = Math.min(this.capacity, this.filled + src.length)
  }

  /** Copy of the newest `n` samples in chronological order (fewer if not filled yet). */
  latest(n: number): Float32Array {
    const count = Math.min(n, this.filled)
    const out = new Float32Array(count)
    const start = (this.write - count + this.capacity) % this.capacity
    const first = Math.min(count, this.capacity - start)
    out.set(this.data.subarray(start, start + first))
    out.set(this.data.subarray(0, count - first), first)
    return out
  }
}
