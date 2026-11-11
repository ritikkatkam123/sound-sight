import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

// The wasm runtime must match the npm package version exactly.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let fileset: Promise<WasmFileset> | null = null

/**
 * useModule: load the ES-module build of the wasm glue, which works inside module Web Workers.
 * That glue registers its factory only when the module first runs, and import() caches modules,
 * so every task gets its own loader URL (a harmless query string) to make the module run again.
 */
async function getFileset(task: string): Promise<WasmFileset> {
  const base = await (fileset ??= FilesetResolver.forVisionTasks(WASM_BASE, true))
  return { ...base, wasmLoaderPath: `${base.wasmLoaderPath}?task=${task}` }
}

interface VideoTask {
  detectForVideo(frame: OffscreenCanvas, timestamp: number): unknown
}

/**
 * Try the GPU delegate first (some browsers/GPUs reject it, so fall back to CPU), then run one
 * throwaway frame. The first GPU inference compiles shaders and can take seconds on a cold cache,
 * so do it now, while the UI says "loading", instead of mid-clap. Works on the main thread or in a worker.
 */
async function withDelegate<T extends VideoTask>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  let task: T
  try {
    task = await create('GPU')
  } catch (e) {
    console.warn('GPU delegate failed, falling back to CPU', e)
    task = await create('CPU')
  }
  const blank = new OffscreenCanvas(320, 180)
  blank.getContext('2d')!.fillRect(0, 0, blank.width, blank.height)
  task.detectForVideo(blank, performance.now())
  return task
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const files = await getFileset('hands')
  return withDelegate((delegate) =>
    HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
  )
}

export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  const files = await getFileset('face')
  return withDelegate((delegate) =>
    FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    }),
  )
}
