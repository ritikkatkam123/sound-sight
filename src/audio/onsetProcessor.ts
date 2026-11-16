// Runs on the audio rendering thread. Vite bundles this file separately (?worker&url).
import { OnsetDetector } from './onsetDetector'

// AudioWorkletGlobalScope isn't in TypeScript's DOM lib, so declare the bits we use.
declare const sampleRate: number
declare const currentFrame: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

export type OnsetMessage =
  | {
      type: 'onset'
      /** AudioContext time (s) of the triggering sample. */
      contextTime: number
      levelDb: number
      brightness: number
    }
  /** Follows its onset by ~40 ms; `contextTime` matches the onset's. */
  | { type: 'tone'; contextTime: number; bass: number }

class OnsetProcessor extends AudioWorkletProcessor {
  private detector = new OnsetDetector({ sampleRate })

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<{ thresholdDb?: number }>) => {
      if (e.data.thresholdDb !== undefined) this.detector.thresholdDb = e.data.thresholdDb
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    // Anchor to the audio clock each block, so skipped blocks (no input) can't skew timestamps.
    const blockStart = this.detector.samplesProcessed
    const time = (sampleIndex: number) => (currentFrame + sampleIndex - blockStart) / sampleRate
    for (const onset of this.detector.process(channel)) {
      const msg: OnsetMessage = {
        type: 'onset',
        contextTime: time(onset.sampleIndex),
        levelDb: onset.levelDb,
        brightness: onset.brightness,
      }
      this.port.postMessage(msg)
    }
    for (const tone of this.detector.takeTones()) {
      const msg: OnsetMessage = { type: 'tone', contextTime: time(tone.sampleIndex), bass: tone.bass }
      this.port.postMessage(msg)
    }
    return true
  }
}

registerProcessor('onset-processor', OnsetProcessor)
