// Runs on the audio rendering thread: batches mic samples into larger chunks for the main thread
// (posting every 128-sample render quantum would mean ~375 messages a second).

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

const CHUNK = 2048

class AudioTapProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK)
  private fill = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    let i = 0
    while (i < channel.length) {
      const n = Math.min(channel.length - i, CHUNK - this.fill)
      this.buf.set(channel.subarray(i, i + n), this.fill)
      this.fill += n
      i += n
      if (this.fill === CHUNK) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(CHUNK)
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('audio-tap-processor', AudioTapProcessor)
