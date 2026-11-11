export type FrameClock = 'capture' | 'display' | 'raf'

/**
 * Calls `cb` once per new camera frame (requestVideoFrameCallback, falling back to rAF).
 * `t` is the camera capture time when the browser exposes it, else the frame's display time,
 * both in the performance.now() timebase. Returns a stop function.
 */
export function onVideoFrame(
  video: HTMLVideoElement,
  cb: (t: number, clock: FrameClock) => void,
): () => void {
  let running = true
  let handle = 0
  const useVfc = 'requestVideoFrameCallback' in video

  const schedule = () => {
    if (!running) return
    if (useVfc) {
      handle = video.requestVideoFrameCallback((now, meta) => {
        if (meta.captureTime !== undefined) cb(meta.captureTime, 'capture')
        else cb(now, 'display')
        schedule()
      })
    } else {
      handle = requestAnimationFrame((now) => {
        cb(now, 'raf')
        schedule()
      })
    }
  }
  schedule()

  return () => {
    running = false
    if (useVfc) video.cancelVideoFrameCallback(handle)
    else cancelAnimationFrame(handle)
  }
}
