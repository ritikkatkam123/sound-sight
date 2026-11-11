import { estimatePitch, levelDb, logBands, spectralCentroid, waveShape } from './features'

export interface AudioFeatures {
  levelDb: number
  /** Fundamental frequency, or null when the sound isn't clearly pitched. */
  pitchHz: number | null
  /** Spectral "brightness" in Hz. */
  centroidHz: number
}

export interface MicStream {
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  /** Current RMS level in dBFS (about -100 when silent, 0 at full scale). */
  levelDb(): number
  /** Level, pitch and brightness of the latest ~43 ms. Pitch detection is costly, so call it sparingly. */
  features(): AudioFeatures
  /** Normalized shape of the current waveform (for drawing it). */
  waveShape(points?: number): Float32Array
  /** Current spectrum as log-spaced 0..1 bands (for an equalizer). */
  bands(count?: number): Float32Array
  close(): Promise<void>
}

/** iOS Safari only lets audio start inside a user gesture, so callers create this in the click handler. */
export function createAudioContext(): AudioContext {
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  void ctx.resume()
  return ctx
}

export function createMicStream(stream: MediaStream, ctx: AudioContext = createAudioContext()): MicStream {
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0
  source.connect(analyser)

  const buf = new Float32Array(analyser.fftSize)
  const spectrum = new Float32Array(analyser.frequencyBinCount)

  return {
    ctx,
    source,
    analyser,
    levelDb() {
      analyser.getFloatTimeDomainData(buf)
      return levelDb(buf)
    },
    features() {
      analyser.getFloatTimeDomainData(buf)
      analyser.getFloatFrequencyData(spectrum)
      return {
        levelDb: levelDb(buf),
        pitchHz: estimatePitch(buf, ctx.sampleRate),
        centroidHz: spectralCentroid(spectrum, ctx.sampleRate),
      }
    },
    waveShape(points = 64) {
      analyser.getFloatTimeDomainData(buf)
      return waveShape(buf, points)
    },
    bands(count = 32) {
      analyser.getFloatFrequencyData(spectrum)
      return logBands(spectrum, ctx.sampleRate, count)
    },
    close: () => ctx.close(),
  }
}
