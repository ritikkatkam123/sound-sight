import { useEffect, useState } from 'react'
import type { SoundEvent } from '../fusion/eventBus'
import type { Classification } from '../audio/classifier'
import type { ModelStatus } from '../vision/visionClient'


export interface DebugStats {
  fps: number
  motionMs: number
  videoClock: string
  handsStatus: ModelStatus
  handsMs: number
  handsCount: number
  faceStatus: ModelStatus
  faceMs: number
  mouthOpen: number | null
  soundStatus: ModelStatus
  rolling: Classification | null
  levelDb: number
  particles: number
  videoSize: string
  sampleRate: number
  audioLatencyMs: number
  onsets: number
  recent: SoundEvent[]
}

export interface Settings {
  showHeatmap: boolean
  showLandmarks: boolean
  handTracking: boolean
  faceTracking: boolean
}

interface Props {
  getStats: () => DebugStats
  settings: Settings
  onSettingsChange: (s: Settings) => void
  startOpen?: boolean
}

// Polls at 10 Hz rather than re-rendering every animation frame.
export function DebugPanel({ getStats, settings, onSettingsChange, startOpen = true }: Props) {
  const [stats, setStats] = useState<DebugStats>(getStats)
  const [open, setOpen] = useState(startOpen)

  useEffect(() => {
    const id = setInterval(() => setStats(getStats()), 100)
    return () => clearInterval(id)
  }, [getStats])

  const meterPct = Math.min(100, Math.max(0, ((stats.levelDb + 70) / 70) * 100))

  return (
    <div className="debug">
      <button className="debug-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide debug' : 'Debug'}
      </button>
      {open && (
        <>
          <dl>
            <dt>FPS</dt>
            <dd>{stats.fps.toFixed(0)}</dd>
            <dt>Motion</dt>
            <dd>
              {stats.motionMs.toFixed(1)} ms/frame · {stats.videoClock} clock
            </dd>
            <dt>Hands</dt>
            <dd>
              <input
                type="checkbox"
                checked={settings.handTracking}
                onChange={(e) => onSettingsChange({ ...settings, handTracking: e.target.checked })}
              />
              {stats.handsStatus === 'ready'
                ? `${stats.handsCount} seen · ${stats.handsMs.toFixed(1)} ms`
                : stats.handsStatus}
            </dd>
            <dt>Face</dt>
            <dd>
              <input
                type="checkbox"
                checked={settings.faceTracking}
                onChange={(e) => onSettingsChange({ ...settings, faceTracking: e.target.checked })}
              />
              {stats.faceStatus === 'ready'
                ? `${stats.mouthOpen === null ? 'no face' : `mouth ${stats.mouthOpen.toFixed(2)}`} · ${stats.faceMs.toFixed(1)} ms`
                : stats.faceStatus}
            </dd>
            <dt>Sound</dt>
            <dd>
              {stats.soundStatus === 'ready'
                ? stats.rolling
                  ? `${stats.rolling.category} ${stats.rolling.score.toFixed(2)} · ${stats.rolling.top[0]?.categoryName ?? '–'} · ${stats.rolling.ms.toFixed(1)} ms`
                  : 'listening…'
                : stats.soundStatus}
            </dd>
            <dt>Mic</dt>
            <dd>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${meterPct}%` }} />
              </div>
              <span className="num">{stats.levelDb.toFixed(1)} dB</span>
            </dd>
            <dt>Particles</dt>
            <dd>{stats.particles}</dd>
            <dt>Video</dt>
            <dd>{stats.videoSize}</dd>
            <dt>Audio</dt>
            <dd>
              {stats.sampleRate} Hz · {stats.audioLatencyMs.toFixed(1)} ms
            </dd>
            <dt>Onsets</dt>
            <dd>{stats.onsets}</dd>
            <dt>Show</dt>
            <dd>
              <label>
                <input
                  type="checkbox"
                  checked={settings.showLandmarks}
                  onChange={(e) => onSettingsChange({ ...settings, showLandmarks: e.target.checked })}
                />
                landmarks
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.showHeatmap}
                  onChange={(e) => onSettingsChange({ ...settings, showHeatmap: e.target.checked })}
                />
                heatmap
              </label>
            </dd>
          </dl>
          {stats.recent.length > 0 && (
            <table className="events">
              <thead>
                <tr>
                  <th>level</th>
                  <th>bright</th>
                  <th>sound</th>
                  <th>source</th>
                  <th>where</th>
                  <th>conf</th>
                  <th>lat</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((e) => (
                  <tr key={e.t}>
                    <td>{e.levelDb.toFixed(0)} dB</td>
                    <td>{e.brightness.toFixed(2)}</td>
                    <td>{e.category ? `${e.category} ${e.categoryScore!.toFixed(2)}` : '…'}</td>
                    <td>{e.source}</td>
                    <td>{e.source === 'fallback' ? 'center' : `${e.x.toFixed(2)}, ${e.y.toFixed(2)}`}</td>
                    <td>{e.confidence.toFixed(2)}</td>
                    <td>{e.latencyMs.toFixed(0)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted hint">Clap or snap in front of the camera · click to test a burst</p>
        </>
      )}
    </div>
  )
}
