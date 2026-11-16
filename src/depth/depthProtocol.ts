/** Messages from the main thread to the depth worker. */
export type DepthRequest =
  | { type: 'init'; w: number; h: number }
  | {
      type: 'frame'
      /** Capture time of the frame (performance.now() timebase of the main thread). */
      t: number
      /** Already resized to the model's input size. */
      bitmap: ImageBitmap
    }
  | { type: 'close' }

/** Messages from the depth worker back to the main thread. */
export type DepthResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  /** WebGPU is missing; the model would be far too slow on the CPU. */
  | { type: 'unsupported'; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'result'
      t: number
      /** Raw relative depth from the model (larger = nearer), `w` × `h`. */
      depth: Float32Array
      w: number
      h: number
      inferMs: number
    }
