import processorUrl from './onsetProcessor.ts?worker&url'
import type { OnsetMessage } from './onsetProcessor'
import type { MicStream } from './micStream'

export interface AudioOnset {
  /** performance.now() timebase, so it can be matched against video frame times. */
  t: number
  levelDb: number
  brightness: number
  /** Share of the hit's energy that is bass (0..1); filled in ~40 ms after the onset is reported. */
  bass?: number
}

export interface OnsetWorklet {
  setThreshold(db: number): void
  dispose(): void
}

export async function createOnsetWorklet(
  mic: MicStream,
  onOnset: (onset: AudioOnset) => void,
): Promise<OnsetWorklet> {
  const { ctx, source } = mic
  await ctx.audioWorklet.addModule(processorUrl)
  const node = new AudioWorkletNode(ctx, 'onset-processor', { numberOfInputs: 1, numberOfOutputs: 1 })

  // Some browsers only run nodes that lead to the destination, so connect through a muted gain.
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(node).connect(sink).connect(ctx.destination)
  if (ctx.state === 'suspended') await ctx.resume()

  let last: { contextTime: number; onset: AudioOnset } | null = null
  node.port.onmessage = (e: MessageEvent<OnsetMessage>) => {
    const msg = e.data
    if (msg.type === 'tone') {
      // Completes the onset already handed out; listeners read it later (when styling the hit).
      if (last?.contextTime === msg.contextTime) last.onset.bass = msg.bass
      return
    }
    // Convert audio-clock time to performance time: "now" minus how long ago the onset sample was.
    const ageMs = (ctx.currentTime - msg.contextTime) * 1000
    const onset: AudioOnset = { t: performance.now() - ageMs, levelDb: msg.levelDb, brightness: msg.brightness }
    last = { contextTime: msg.contextTime, onset }
    onOnset(onset)
  }

  return {
    setThreshold: (db) => node.port.postMessage({ thresholdDb: db }),
    dispose() {
      node.port.onmessage = null
      source.disconnect(node)
      node.disconnect()
      sink.disconnect()
    },
  }
}
