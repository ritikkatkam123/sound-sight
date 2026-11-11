// Runs YAMNet off the main thread: each classification costs 15–20 ms, several times a second.
import { SoundClassifier, type Classification } from './classifier'

export type ClassifierRequest = { type: 'classify'; id: number; samples: Float32Array; sampleRate: number } | { type: 'close' }
export type ClassifierResponse =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; result: Classification }

// This file is a worker, but the project's TS lib is DOM, so type the worker scope by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ClassifierRequest>) => void) | null
  postMessage(msg: ClassifierResponse): void
}

const ready = SoundClassifier.create()
ready.then(
  () => scope.postMessage({ type: 'ready' }),
  (e: unknown) => scope.postMessage({ type: 'error', message: String(e) }),
)

scope.onmessage = async (e) => {
  const msg = e.data
  const classifier = await ready
  if (msg.type === 'close') classifier.dispose()
  else scope.postMessage({ type: 'result', id: msg.id, result: classifier.classify(msg.samples, msg.sampleRate) })
}
