import type { Pt } from './hands'

/** Messages from the main thread to the vision worker. */
export type VisionRequest =
  | { type: 'init' }
  | {
      type: 'frame'
      /** Capture time of the frame (performance.now() timebase of the main thread). */
      t: number
      bitmap: ImageBitmap
      /** Width ÷ height of the source video, for aspect-correct mouth measurements. */
      aspect: number
      hands: boolean
      face: boolean
    }
  | { type: 'close' }

export interface MouthResult {
  center: Pt
  open: number
}

/** Messages from the vision worker back to the main thread. */
export type VisionResponse =
  | { type: 'ready'; task: 'hands' | 'face' }
  | { type: 'error'; task: 'hands' | 'face'; message: string }
  | {
      type: 'result'
      t: number
      /** 21 points per detected hand, or null if hand tracking was skipped for this frame. */
      hands: Pt[][] | null
      /** undefined = face tracking skipped for this frame; null = ran but found no face. */
      mouth?: MouthResult | null
      handsMs: number
      faceMs: number
    }
