import { useEffect, useState } from 'react'
import { DEPTH_MODES, matchPreset, PRESETS, type Look, type PresetName } from '../visuals/look'
import type { DepthMode } from '../visuals/depthField'
import type { DepthStatus } from '../depth/depthClient'
import type { Prefs } from './prefs'

/** What the Look panel shows about the depth model while it loads. */
export interface DepthInfo {
  status: DepthStatus
  loaded: number
  total: number
  message: string
}

interface Props {
  prefs: Prefs
  onChange: (p: Prefs) => void
  /** Current depth model state, or null when depth is off. Polled while the panel is open. */
  getDepthInfo: () => DepthInfo | null
}

const DEPTH_LABELS: Record<DepthMode, string> = { off: 'Off', waves: 'Waves', cloud: 'Cloud' }

const PRESET_LABELS: Record<PresetName, string> = {
  neon: 'Neon',
  dreamy: 'Dreamy',
  minimal: 'Minimal',
  party: 'Party',
  scan: 'Scan',
}

export function SettingsPanel({ prefs, onChange, getDepthInfo }: Props) {
  const [open, setOpen] = useState(false)
  const [depthInfo, setDepthInfo] = useState<DepthInfo | null>(null)
  const depthOn = prefs.look.depth !== 'off'
  // Poll the model's loading state only while it's visible and relevant.
  useEffect(() => {
    if (!open || !depthOn) return
    const tick = () => setDepthInfo(getDepthInfo())
    tick()
    const id = window.setInterval(tick, 250)
    return () => clearInterval(id)
  }, [open, depthOn, getDepthInfo])
  const active = matchPreset(prefs.look)
  const setLook = (patch: Partial<Look>) => onChange({ ...prefs, look: { ...prefs.look, ...patch } })

  return (
    <div className="settings">
      {open && (
        <div className="settings-card" role="dialog" aria-label="Visual settings">
          <div className="presets">
            {(Object.keys(PRESETS) as PresetName[]).map((name) => (
              <button
                key={name}
                className={active === name ? 'chip active' : 'chip'}
                onClick={() => onChange({ ...prefs, look: PRESETS[name] })}
              >
                {PRESET_LABELS[name]}
              </button>
            ))}
            {active === 'custom' && <span className="chip active static">Custom</span>}
          </div>
          <Slider label="Glow" value={prefs.look.glow} min={0} max={1} step={0.05} onChange={(glow) => setLook({ glow })} />
          <Slider label="Trails" value={prefs.look.trails} min={0} max={1} step={0.05} onChange={(trails) => setLook({ trails })} />
          <Slider
            label="Intensity"
            value={prefs.look.intensity}
            min={0.5}
            max={2}
            step={0.1}
            onChange={(intensity) => setLook({ intensity })}
          />
          <label className="row">
            <span>Screen shake</span>
            <input type="checkbox" checked={prefs.look.shake} onChange={(e) => setLook({ shake: e.target.checked })} />
          </label>
          <div className="row">
            <span>Depth</span>
            <div className="presets">
              {DEPTH_MODES.map((mode) => (
                <button
                  key={mode}
                  className={prefs.look.depth === mode ? 'chip active' : 'chip'}
                  onClick={() => setLook({ depth: mode })}
                >
                  {DEPTH_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
          {depthOn && depthInfo && <DepthStatusLine info={depthInfo} />}
          {/* Shown as sensitivity (higher = more sensitive), stored as a threshold (lower = more sensitive). */}
          <Slider
            label="Sensitivity"
            value={26 - prefs.thresholdDb}
            min={6}
            max={20}
            step={1}
            onChange={(v) => onChange({ ...prefs, thresholdDb: 26 - v })}
          />
        </div>
      )}
      <button className="settings-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Close' : 'Look'}
      </button>
    </div>
  )
}

function DepthStatusLine({ info }: { info: DepthInfo }) {
  const mb = (bytes: number) => (bytes / 1e6).toFixed(0)
  let text: string
  if (info.status === 'loading') {
    text = info.total > 0 ? `Loading depth model… ${mb(info.loaded)} / ${mb(info.total)} MB` : 'Loading depth model…'
  } else if (info.status === 'unsupported') text = `Depth unavailable: ${info.message}`
  else if (info.status === 'error') text = 'Depth model failed to load.'
  else return null
  return <p className={info.status === 'loading' ? 'muted depth-status' : 'error depth-status'}>{text}</p>
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}
