import { AudioClassifier, FilesetResolver } from '@mediapipe/tasks-audio'
import { categorize, type CategoryResult, type LabelScore } from './categories'

// The wasm runtime must match the npm package version exactly.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/wasm'
const YAMNET_MODEL = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite'

/** YAMNet looks at 0.975 s windows. */
export const WINDOW_S = 0.975

export interface Classification extends CategoryResult {
  /** Top raw YAMNet labels, for the debug panel. */
  top: LabelScore[]
  /** Inference time, ms. */
  ms: number
}

export class SoundClassifier {
  private readonly model: AudioClassifier

  private constructor(model: AudioClassifier) {
    this.model = model
  }

  static async create(): Promise<SoundClassifier> {
    // useModule: the ES-module build of the wasm glue, which works inside module Web Workers.
    const files = await FilesetResolver.forAudioTasks(WASM_BASE, true)
    const model = await AudioClassifier.createFromOptions(files, {
      baseOptions: { modelAssetPath: YAMNET_MODEL },
      maxResults: 10,
      scoreThreshold: 0.02,
    })
    return new SoundClassifier(model)
  }

  /** Classify one YAMNet window (WINDOW_S seconds) of audio. */
  classify(samples: Float32Array, sampleRate: number): Classification {
    const start = performance.now()
    const results = this.model.classify(samples, sampleRate)
    // Use the first window. At 48 kHz, resampling leaves a sliver of leftover samples that MediaPipe
    // pads into a second, near-empty window, which always reads "Silence".
    const categories = results[0]?.classifications[0]?.categories ?? []
    const top = categories.map(({ categoryName, score }) => ({ categoryName, score }))
    return { ...categorize(top), top: top.slice(0, 3), ms: performance.now() - start }
  }

  dispose(): void {
    this.model.close()
  }
}
