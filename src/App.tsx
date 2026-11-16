import { useCallback, useEffect, useRef, useState } from 'react'
import { requestMedia } from './media'
import { attachCamera } from './vision/camera'
import { MotionTracker } from './vision/motion'
import { VisionClient } from './vision/visionClient'
import { createAudioContext, createMicStream, type MicStream } from './audio/micStream'
import { createOnsetWorklet, type AudioOnset, type OnsetWorklet } from './audio/onsetWorklet'
import { createAudioTap, type AudioTap } from './audio/audioTap'
import { ClassifierClient } from './audio/classifierClient'
import type { Classification } from './audio/classifier'
import { hitCategory, SUSTAINED } from './audio/categories'
import { isKick } from './audio/onsetDetector'
import { localize } from './fusion/localize'
import { localizeHands } from './fusion/handLocalize'
import { EventBus, type SoundEvent } from './fusion/eventBus'
import { Stage } from './visuals/stage'
import { brightnessColor, levelIntensity } from './visuals/palette'
import { accentEffect, CATEGORY_COLOR, onsetEffect } from './visuals/effects'
import { SustainedEffects } from './visuals/sustained'
import { PermissionGate } from './ui/PermissionGate'
import { DebugPanel, type DebugStats, type Settings } from './ui/DebugPanel'
import { SettingsPanel, type DepthInfo } from './ui/SettingsPanel'
import { DepthClient } from './depth/depthClient'
import type { ScanWave } from './visuals/depthField'
import { loadPrefs, savePrefs, type Prefs } from './ui/prefs'

type Status = 'idle' | 'starting' | 'running' | 'error'

const RECENT_EVENTS = 5
/** Wait this long after an onset before classifying, so the window holds the sound's body, not just its attack. */
const CLASSIFY_DELAY_MS = 150
/** How often the rolling classifier runs (drives the voice/whistle/music effects). */
const ROLLING_MS = 250
/** Phones get the debug panel collapsed and skip face tracking until asked, to save battery. */
const isSmallScreen = () => window.matchMedia('(max-width: 640px)').matches
/** A mouth position older than this is too stale to place effects at. */
const MOUTH_FRESH_MS = 500
/** How long a "beatboxing" reading from the rolling classifier keeps counting. */
const BEAT_SESSION_MS = 1500

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string>()
  const [media, setMedia] = useState<{ stream: MediaStream; audio: AudioContext }>()
  const stream = media?.stream
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [settings, setSettings] = useState<Settings>(() => ({
    showHeatmap: false,
    showLandmarks: false,
    handTracking: true,
    faceTracking: !isSmallScreen(),
  }))

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const heatRef = useRef<HTMLCanvasElement>(null)
  const micRef = useRef<MicStream>(null)
  const stageRef = useRef<Stage>(null)
  const motionRef = useRef<MotionTracker>(null)
  const visionRef = useRef<VisionClient>(null)
  const classifierRef = useRef<ClassifierClient>(null)
  const tapRef = useRef<AudioTap>(null)
  const rollingRef = useRef<{ result: Classification | null; at: number }>({ result: null, at: 0 })
  const onsetRef = useRef<OnsetWorklet>(null)
  const depthRef = useRef<DepthClient>(null)
  const busRef = useRef(new EventBus())
  const eventsRef = useRef<{ count: number; recent: SoundEvent[] }>({ count: 0, recent: [] })
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const start = async () => {
    setStatus('starting')
    // Create the AudioContext synchronously inside the click: iOS Safari won't start audio otherwise.
    const audio = createAudioContext()
    try {
      setMedia({ stream: await requestMedia(), audio })
      setStatus('running')
    } catch (e) {
      void audio.close()
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
      setStatus('error')
    }
  }

  // Once the stream exists and the video/overlay elements are mounted, wire everything up.
  useEffect(() => {
    if (!media || !videoRef.current || !overlayRef.current) return
    const { stream, audio } = media
    const video = videoRef.current
    const overlay = overlayRef.current
    const bus = busRef.current
    let cancelled = false
    const stage = new Stage()
    const mic = createMicStream(stream, audio)
    const motion = new MotionTracker(video)
    // The ML models run in Web Workers so inference never blocks rendering or audio handling.
    const vision = new VisionClient(video)
    vision.setEnabled(settingsRef.current.handTracking, settingsRef.current.faceTracking)
    micRef.current = mic
    motionRef.current = motion
    visionRef.current = vision

    const freshMouth = () => {
      const m = vision.face.latest
      return m && performance.now() - m.t < MOUTH_FRESH_MS ? m.center : null
    }
    /** While someone is beatboxing, every hit comes out of their mouth, whatever else is moving. */
    const beatboxing = () => {
      const { result, at } = rollingRef.current
      return !!result && performance.now() - at < BEAT_SESSION_MS && (result.scores.beat ?? 0) >= 0.15
    }

    // Audio says *when*; vision says *where*: the mouth while beatboxing, then tracked hands,
    // then raw motion, then the frame center.
    const handleOnset = (onset: AudioOnset) => {
      const s = stageRef.current
      if (!s) return
      const hands = vision.hands
      const mouth = beatboxing() ? freshMouth() : null
      const where =
        (mouth && { x: mouth.x, y: mouth.y, confidence: 1, source: 'mouth' as const }) ??
        (vision.handsActive ? localizeHands(onset.t, hands.history, { aspect: hands.aspect }) : null) ??
        localize(onset.t, motion.history, motion.gw, motion.gh)
      const intensity = levelIntensity(onset.levelDb) * (where.source === 'fallback' ? 0.5 : 1)
      const classifier = classifierRef.current?.status === 'ready' ? classifierRef.current : null
      // Show something instantly; if a classifier is available, start neutral and restyle once it has a label.
      const startColor = classifier ? CATEGORY_COLOR.other : brightnessColor(onset.brightness)
      const group = onsetEffect(s, where, intensity, startColor)
      // With depth on, every sound also sends a LiDAR-style scan wave across the scene from where it came from.
      const depth = depthRef.current
      const wave: ScanWave | null =
        depth?.ready && prefsRef.current.look.depth !== 'off' ? s.scanWave(where.x, where.y, startColor) : null
      const event: SoundEvent = { ...onset, ...where, latencyMs: performance.now() - onset.t }
      bus.emit(event)
      if (!classifier) return

      setTimeout(async () => {
        const classified = await classifier.classify()
        if (!classified || !stageRef.current) return
        const result = hitCategory(classified)
        event.category = result.category
        event.categoryScore = result.score
        event.bass = onset.bass
        const color = result.category === 'other' ? brightnessColor(onset.brightness) : CATEGORY_COLOR[result.category]
        wave?.retint(color)
        if (SUSTAINED.has(result.category)) {
          // A plosive in speech or a beat in music: the continuous effects already cover it.
          group.fadeOut(0.15)
        } else {
          group.retint(color)
          // Beatboxing comes out of the mouth, wherever the motion was.
          const at = (result.category === 'beat' && freshMouth()) || where
          accentEffect(stageRef.current, result.category, at, intensity, isKick(onset))
        }
      }, CLASSIFY_DELAY_MS)
    }

    const offBus = bus.on((e) => {
      const log = eventsRef.current
      log.count++
      log.recent = [e, ...log.recent].slice(0, RECENT_EVENTS)
    })

    // The models are ~15 MB together, so load them in the background; motion-based placement works meanwhile.
    let rollingTimer = 0
    const loadModels = async () => {
      vision.start()
      const tap = await createAudioTap(mic)
      if (cancelled) return tap.dispose()
      const classifier = new ClassifierClient(tap)
      tapRef.current = tap
      classifierRef.current = classifier
      let rollingBusy = false
      rollingTimer = window.setInterval(async () => {
        if (rollingBusy) return
        rollingBusy = true
        const result = await classifier.classify()
        rollingBusy = false
        if (result) rollingRef.current = { result, at: performance.now() }
      }, ROLLING_MS)
    }

    ;(async () => {
      await attachCamera(video, stream)
      await stage.init(overlay, video)
      const onsets = await createOnsetWorklet(mic, handleOnset)
      if (cancelled) {
        onsets.dispose()
        stage.destroy()
        return
      }
      stageRef.current = stage
      onsetRef.current = onsets
      onsets.setThreshold(prefsRef.current.thresholdDb)
      stage.setLook(prefsRef.current.look)
      stage.setDepthMode(prefsRef.current.look.depth)
      motion.start()
      const sustained = new SustainedEffects(stage)
      let depthVersion = -1
      stage.app.ticker.add(() => {
        const depth = depthRef.current
        const version = depth?.map ? depth.version : -1
        if (version !== depthVersion) {
          depthVersion = version
          stage.setDepthMap(depth?.map ?? null, version)
        }
        sustained.update(performance.now(), {
          classification: rollingRef.current.result,
          classifiedAt: rollingRef.current.at,
          mouth: vision.face.latest?.center ?? null,
          features: () => mic.features(),
          waveShape: () => mic.waveShape(),
          bands: () => mic.bands(),
        })
        const show = settingsRef.current.showLandmarks
        stage.drawLandmarks(show ? vision.hands.latest : null, show ? vision.face.latest : null)
      })
      await loadModels()
    })().catch((e) => {
      setError(String(e))
      setStatus('error')
    })

    return () => {
      cancelled = true
      offBus()
      clearInterval(rollingTimer)
      classifierRef.current?.dispose()
      classifierRef.current = null
      tapRef.current?.dispose()
      tapRef.current = null
      rollingRef.current = { result: null, at: 0 }
      motion.stop()
      vision.dispose()
      visionRef.current = null
      onsetRef.current?.dispose()
      onsetRef.current = null
      if (stageRef.current === stage) {
        stage.destroy()
        stageRef.current = null
      }
      void mic.close()
      micRef.current = null
      motionRef.current = null
    }
  }, [media])

  // Stop camera/mic tracks when the app unmounts.
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])

  // Push debug settings into the running pipeline.
  useEffect(() => {
    if (motionRef.current) motionRef.current.heatCanvas = settings.showHeatmap ? heatRef.current : null
    visionRef.current?.setEnabled(settings.handTracking, settings.faceTracking)
  }, [settings, status])

  // User-facing preferences: apply live and remember them for next time.
  useEffect(() => {
    onsetRef.current?.setThreshold(prefs.thresholdDb)
    stageRef.current?.setLook(prefs.look)
    stageRef.current?.setDepthMode(prefs.look.depth)
    savePrefs(prefs)
  }, [prefs, status])

  // The depth model is ~50 MB, so it's only created (and downloaded) while a depth mode is on.
  const depthOn = prefs.look.depth !== 'off'
  useEffect(() => {
    const video = videoRef.current
    if (!depthOn || !media || !video) return
    const depth = new DepthClient(video)
    depthRef.current = depth
    // The model input size follows the camera's aspect ratio, so wait until it's known.
    const begin = () => depth.start()
    if (video.videoWidth) begin()
    else video.addEventListener('loadedmetadata', begin, { once: true })
    return () => {
      video.removeEventListener('loadedmetadata', begin)
      depth.dispose()
      if (depthRef.current === depth) depthRef.current = null
    }
  }, [depthOn, media])

  const getDepthInfo = useCallback((): DepthInfo | null => {
    const d = depthRef.current
    return d ? { status: d.status, loaded: d.progress.loaded, total: d.progress.total, message: d.message } : null
  }, [])

  const getStats = useCallback((): DebugStats => {
    const stage = stageRef.current
    const mic = micRef.current
    const video = videoRef.current
    const vision = visionRef.current
    return {
      fps: stage?.app.ticker.FPS ?? 0,
      motionMs: motionRef.current?.stepMs ?? 0,
      videoClock: motionRef.current?.clock ?? '–',
      handsStatus: !vision ? 'loading' : vision.handsEnabled ? vision.status.hands : 'off',
      handsMs: vision?.hands.inferMs ?? 0,
      handsCount: vision?.hands.latest.length ?? 0,
      faceStatus: !vision ? 'loading' : vision.faceEnabled ? vision.status.face : 'off',
      faceMs: vision?.face.inferMs ?? 0,
      mouthOpen: vision?.face.latest?.open ?? null,
      soundStatus: classifierRef.current?.status ?? 'loading',
      depth: !depthRef.current
        ? 'off'
        : depthRef.current.ready
          ? `ready · ${depthRef.current.inferMs.toFixed(0)} ms`
          : depthRef.current.status,
      rolling: rollingRef.current.result,
      levelDb: mic?.levelDb() ?? -100,
      particles: stage?.particleCount ?? 0,
      videoSize: video?.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '–',
      sampleRate: mic?.ctx.sampleRate ?? 0,
      audioLatencyMs: ((mic?.ctx.baseLatency ?? 0) + (mic?.ctx.outputLatency ?? 0)) * 1000,
      onsets: eventsRef.current.count,
      recent: eventsRef.current.recent,
    }
  }, [])

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = e.currentTarget.getBoundingClientRect()
    const { nx, ny } = stage.toVideo(e.clientX - rect.left, e.clientY - rect.top)
    stage.burst(nx, ny, 1)
  }

  if (status !== 'running') {
    return <PermissionGate status={status} error={error} onStart={start} />
  }

  return (
    <div className="viewport">
      <video ref={videoRef} className="camera" />
      <canvas ref={heatRef} className="heatmap" hidden={!settings.showHeatmap} />
      <div ref={overlayRef} className="overlay" onClick={onClick} />
      <DebugPanel getStats={getStats} settings={settings} onSettingsChange={setSettings} startOpen={!isSmallScreen()} />
      <SettingsPanel prefs={prefs} onChange={setPrefs} getDepthInfo={getDepthInfo} />
    </div>
  )
}
