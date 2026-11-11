// One getUserMedia call so the browser shows a single permission prompt.
export async function requestMedia(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    // Browser audio processing smooths out sharp transients like claps, so turn it off.
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
}
