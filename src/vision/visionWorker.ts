// Runs the MediaPipe hand and face models off the main thread, so inference (and the multi-second
// GPU shader compile on first use) never stalls rendering or audio handling.
import type { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'
import { createFaceLandmarker, createHandLandmarker } from './landmarkers'
import { dist, type Pt } from './hands'
import type { MouthResult, VisionRequest, VisionResponse } from './visionProtocol'

// This file is a worker, but the project's TS lib is DOM, so type the worker scope by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<VisionRequest>) => void) | null
  postMessage(msg: VisionResponse): void
}

// Face-mesh landmark indices.
const UPPER_LIP = 13
const LOWER_LIP = 14
const MOUTH_LEFT = 61
const MOUTH_RIGHT = 291

let hands: HandLandmarker | null = null
let face: FaceLandmarker | null = null
let lastTs = 0

/** detectForVideo requires strictly increasing timestamps. */
const nextTs = () => (lastTs = Math.max(lastTs + 1, performance.now()))

const load = <T>(task: 'hands' | 'face', create: () => Promise<T>, set: (t: T) => void) =>
  create()
    .then((t) => {
      set(t)
      scope.postMessage({ type: 'ready', task })
    })
    .catch((e: unknown) => scope.postMessage({ type: 'error', task, message: String(e) }))

scope.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    // Load one after the other: two simultaneous GPU shader compiles just contend with each other.
    void load('hands', createHandLandmarker, (t) => (hands = t)).then(() =>
      load('face', createFaceLandmarker, (t) => (face = t)),
    )
  } else if (msg.type === 'close') {
    hands?.close()
    face?.close()
    hands = face = null
  } else {
    let handPts: Pt[][] | null = null
    let mouth: MouthResult | null | undefined
    let handsMs = 0
    let faceMs = 0

    if (msg.hands && hands) {
      const start = performance.now()
      const r = hands.detectForVideo(msg.bitmap, nextTs())
      handsMs = performance.now() - start
      handPts = r.landmarks.map((lms) => lms.map(({ x, y }) => ({ x, y })))
    }
    if (msg.face && face) {
      const start = performance.now()
      const lms = face.detectForVideo(msg.bitmap, nextTs()).faceLandmarks[0]
      faceMs = performance.now() - start
      mouth = lms
        ? {
            center: { x: (lms[UPPER_LIP].x + lms[LOWER_LIP].x) / 2, y: (lms[UPPER_LIP].y + lms[LOWER_LIP].y) / 2 },
            open:
              dist(lms[UPPER_LIP], lms[LOWER_LIP], msg.aspect) /
              Math.max(1e-6, dist(lms[MOUTH_LEFT], lms[MOUTH_RIGHT], msg.aspect)),
          }
        : null
    }
    msg.bitmap.close()
    scope.postMessage({ type: 'result', t: msg.t, hands: handPts, mouth, handsMs, faceMs })
  }
}
