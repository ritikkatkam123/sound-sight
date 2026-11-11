import { useState } from 'react'
import { matchPreset, PRESETS, type Look, type PresetName } from '../visuals/look'
import type { Prefs } from './prefs'

interface Props {
  prefs: Prefs
  onChange: (p: Prefs) => void
}

const PRESET_LABELS: Record<PresetName, string> = {
  neon: 'Neon',
  dreamy: 'Dreamy',
  minimal: 'Minimal',
  party: 'Party',
}

export function SettingsPanel({ prefs, onChange }: Props) {
  const [open, setOpen] = useState(false)
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
