export async function attachCamera(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = new MediaStream(stream.getVideoTracks())
  video.muted = true
  video.playsInline = true
  await video.play()
}
