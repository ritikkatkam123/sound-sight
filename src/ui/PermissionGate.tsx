interface Props {
  status: 'idle' | 'starting' | 'error'
  error?: string
  onStart: () => void
}

/** Why this browser can't run the app, or null if it can. */
function unsupportedReason(): string | null {
  if (!window.isSecureContext) return 'Camera access needs a secure (https://) page.'
  if (!navigator.mediaDevices?.getUserMedia) return "This browser can't access the camera and microphone."
  if (typeof AudioWorkletNode === 'undefined' || typeof Worker === 'undefined') {
    return 'This browser is missing features SoundSight needs. Try a recent Chrome, Edge, Firefox or Safari.'
  }
  return null
}

// The start button also serves as the user gesture browsers require before an AudioContext can run.
export function PermissionGate({ status, error, onStart }: Props) {
  const unsupported = unsupportedReason()
  return (
    <div className="gate">
      <h1>SoundSight</h1>
      <p>Make a sound in front of the camera and see it light up where it came from.</p>
      <p className="muted">Needs camera and microphone access. Everything is processed on your device.</p>
      <button onClick={onStart} disabled={status === 'starting' || unsupported !== null}>
        {status === 'starting' ? 'Starting…' : 'Start camera & mic'}
      </button>
      {unsupported && <p className="error">{unsupported}</p>}
      {status === 'error' && <p className="error">{friendlyError(error)}</p>}
    </div>
  )
}

function friendlyError(error = ''): string {
  if (error.startsWith('NotAllowedError')) return 'Camera or microphone access was blocked. Allow it in your browser’s site settings, then try again.'
  if (error.startsWith('NotFoundError')) return 'No camera or microphone was found.'
  if (error.startsWith('NotReadableError')) return 'The camera or microphone is in use by another app.'
  return error
}
