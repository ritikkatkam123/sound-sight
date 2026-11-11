import processorUrl from './audioTapProcessor.ts?worker&url'
import { RingBuffer } from './ringBuffer'
import type { MicStream } from './micStream'

export interface AudioTap {
  /** The most recent audio, at the AudioContext's sample rate. */
  readonly ring: RingBuffer
  readonly sampleRate: number
  dispose(): void
}

/** Streams mic audio into a rolling buffer on the main thread (for the sound classifier). */
export async function createAudioTap(mic: MicStream, seconds = 1.5): Promise<AudioTap> {
  const { ctx, source } = mic
  await ctx.audioWorklet.addModule(processorUrl)
  const node = new AudioWorkletNode(ctx, 'audio-tap-processor', { numberOfInputs: 1, numberOfOutputs: 1 })
  const ring = new RingBuffer(Math.ceil(ctx.sampleRate * seconds))

  // As with the onset node, route through a muted gain so the node keeps being processed.
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(node).connect(sink).connect(ctx.destination)
  node.port.onmessage = (e: MessageEvent<Float32Array>) => ring.push(e.data)

  return {
    ring,
    sampleRate: ctx.sampleRate,
    dispose() {
      node.port.onmessage = null
      source.disconnect(node)
      node.disconnect()
      sink.disconnect()
    },
  }
}
