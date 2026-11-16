// Runs the Depth Anything V2 Small model on WebGPU, off the main thread. It turns one camera frame
// into a relative depth map; everything after that (smoothing, drawing) happens on the main thread.
import { AutoModel, Tensor, env, type PreTrainedModel } from '@huggingface/transformers'
import type { DepthRequest, DepthResponse } from './depthProtocol'

const MODEL_ID = 'onnx-community/depth-anything-v2-small'
// ImageNet normalization, from the model's preprocessor_config.json.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

// This file is a worker, but the project's TS lib is DOM, so type the worker scope by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DepthRequest>) => void) | null
  postMessage(msg: DepthResponse, transfer?: Transferable[]): void
}

env.allowLocalModels = false

let model: PreTrainedModel | null = null
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let input = new Float32Array(0)

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

/** RGBA pixels → normalized planar RGB, the layout the model expects. */
function toTensor(rgba: Uint8ClampedArray, w: number, h: number): Tensor {
  const n = w * h
  if (input.length !== 3 * n) input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    input[i] = (rgba[i * 4] / 255 - MEAN[0]) / STD[0]
    input[n + i] = (rgba[i * 4 + 1] / 255 - MEAN[1]) / STD[1]
    input[2 * n + i] = (rgba[i * 4 + 2] / 255 - MEAN[2]) / STD[2]
  }
  return new Tensor('float32', input, [1, 3, h, w])
}

async function run(pixels: Tensor): Promise<Float32Array> {
  const out = (await model!({ pixel_values: pixels })) as { predicted_depth: Tensor }
  let depth = out.predicted_depth
  if (depth.type !== 'float32') depth = depth.to('float32')
  // Copy out: the tensor's buffer may be reused by the next run.
  const data = Float32Array.from(depth.data as Float32Array)
  out.predicted_depth.dispose()
  return data
}

async function init(w: number, h: number): Promise<void> {
  if (!(await hasWebGpu())) {
    scope.postMessage({ type: 'unsupported', message: 'This browser has no WebGPU, which depth scanning needs.' })
    return
  }
  model = await AutoModel.from_pretrained(MODEL_ID, {
    device: 'webgpu',
    dtype: 'fp16',
    progress_callback: (p) => {
      if (p.status === 'progress_total') scope.postMessage({ type: 'progress', loaded: p.loaded, total: p.total })
    },
  })
  // The first run compiles the GPU shaders (slow); do it now rather than on the first real frame.
  await run(new Tensor('float32', new Float32Array(3 * w * h), [1, 3, h, w]))
  scope.postMessage({ type: 'ready' })
}

scope.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    init(msg.w, msg.h).catch((err: unknown) => scope.postMessage({ type: 'error', message: String(err) }))
  } else if (msg.type === 'close') {
    void model?.dispose()
    model = null
  } else {
    const { bitmap, t } = msg
    const { width: w, height: h } = bitmap
    if (!model) {
      bitmap.close()
      return
    }
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h)
      ctx = canvas.getContext('2d', { willReadFrequently: true })
    }
    ctx!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const start = performance.now()
    run(toTensor(ctx!.getImageData(0, 0, w, h).data, w, h))
      .then((depth) => {
        const inferMs = performance.now() - start
        scope.postMessage({ type: 'result', t, depth, w, h, inferMs }, [depth.buffer])
      })
      .catch((err: unknown) => scope.postMessage({ type: 'error', message: String(err) }))
  }
}
