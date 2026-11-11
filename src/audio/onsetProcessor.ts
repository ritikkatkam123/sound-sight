// Runs on the audio rendering thread. Vite bundles this file separately (?worker&url).
import { OnsetDetector } from './onsetDetector'

// AudioWorkletGlobalScope isn't in TypeScript's DOM lib, so declare the bits we use.
declare const sampleRate: number
declare const currentFrame: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

export interface OnsetMessage {
  /** AudioContext time (s) of the triggering sample. */
  contextTime: number
  levelDb: number
  brightness: number
}

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
    for (const onset of this.detector.process(channel)) {
      const msg: OnsetMessage = {
        contextTime: (currentFrame + onset.sampleIndex - blockStart) / sampleRate,
        levelDb: onset.levelDb,
        brightness: onset.brightness,
      }
      this.port.postMessage(msg)
    }
    return true
  }
}

registerProcessor('onset-processor', OnsetProcessor)
