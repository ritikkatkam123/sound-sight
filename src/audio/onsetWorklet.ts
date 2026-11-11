import processorUrl from './onsetProcessor.ts?worker&url'
import type { OnsetMessage } from './onsetProcessor'
import type { MicStream } from './micStream'

export interface AudioOnset {
  /** performance.now() timebase, so it can be matched against video frame times. */
  t: number
  levelDb: number
  brightness: number
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

  node.port.onmessage = (e: MessageEvent<OnsetMessage>) => {
    // Convert audio-clock time to performance time: "now" minus how long ago the onset sample was.
    const ageMs = (ctx.currentTime - e.data.contextTime) * 1000
    onOnset({ t: performance.now() - ageMs, levelDb: e.data.levelDb, brightness: e.data.brightness })
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
