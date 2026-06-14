// ── Motion Maker — transport / timeline ────────────────────────────────────────
//
// Frame-based playhead with a Houdini-style keymap. Owns nothing but the readout
// and scrub UI; the actual `frame` + `playing` state lives in index.jsx so export
// can read it. Keymap is registered there too (needs to coexist with undo/redo).
import { C, btn } from '../LogoMaker/ui.jsx'
import { EditableNumber } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'

const ACCENT = '#ff7849'

export default function Timeline({
  frame, setFrame, playing, setPlaying, loop, setLoop,
  fps, setFps, frameStart, frameEnd, setFrameStart, setFrameEnd,
}) {
  const dur = frameEnd - frameStart
  const secs = (f) => (f / (fps || 1)).toFixed(2)
  const pct = dur > 0 ? ((frame - frameStart) / dur) * 100 : 0

  function scrub(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const set = (clientX) => {
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      setFrame(Math.round(frameStart + t * dur))
    }
    set(e.clientX)
    const move = (e2) => set(e2.clientX)
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  const tbtn = (active) => ({ ...btn(false), padding: '4px 7px', display: 'flex', alignItems: 'center', color: active ? ACCENT : C.muted })

  return (
    <div style={{
      flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.panel,
      padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* transport buttons */}
      <div style={{ display: 'flex', gap: 3 }}>
        <button title="First frame (Ctrl+←)" style={tbtn(false)} onClick={() => setFrame(frameStart)}><Icon name="first_page" size={16} /></button>
        <button title="Step back (←)" style={tbtn(false)} onClick={() => setFrame(Math.max(frameStart, frame - 1))}><Icon name="skip_previous" size={16} /></button>
        <button title="Play / pause (Space)" style={tbtn(playing)} onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play_arrow'} size={16} /></button>
        <button title="Step forward (→)" style={tbtn(false)} onClick={() => setFrame(Math.min(frameEnd, frame + 1))}><Icon name="skip_next" size={16} /></button>
        <button title="Last frame (Ctrl+→)" style={tbtn(false)} onClick={() => setFrame(frameEnd)}><Icon name="last_page" size={16} /></button>
        <button title="Loop" style={tbtn(loop)} onClick={() => setLoop(!loop)}><Icon name="loop" size={16} /></button>
      </div>

      {/* scrub track */}
      <div onMouseDown={scrub} style={{ flex: 1, height: 22, position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, background: C.ctrl, borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, background: ACCENT, borderRadius: 2, opacity: 0.5 }} />
        <div style={{ position: 'absolute', left: `${pct}%`, width: 2, height: 18, background: ACCENT, transform: 'translateX(-1px)', borderRadius: 1 }} />
      </div>

      {/* readout: frame N / end · Ns / Ns · fps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        <span style={{ color: C.text }}>f</span>
        <EditableNumber value={frame} onChange={setFrame} min={frameStart} max={frameEnd} step={1} accent={ACCENT} width={42} color={C.text} />
        <span>/ {frameEnd}</span>
        <span style={{ color: C.dim }}>·</span>
        <span style={{ color: ACCENT }}>{secs(frame)}s</span>
        <span>/ {secs(dur)}s</span>
        <span style={{ color: C.dim }}>·</span>
        <EditableNumber value={fps} onChange={v => setFps(Math.max(1, Math.round(v)))} min={1} max={120} step={1} accent={ACCENT} width={30} color={C.muted} />
        <span>fps</span>
      </div>

      {/* frame range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.dim, borderLeft: `1px solid ${C.border}`, paddingLeft: 10 }}>
        <span>range</span>
        <EditableNumber value={frameStart} onChange={v => setFrameStart(Math.min(frameEnd - 1, Math.round(v)))} min={0} max={6000} step={1} accent={ACCENT} width={34} color={C.muted} />
        <span>–</span>
        <EditableNumber value={frameEnd} onChange={v => setFrameEnd(Math.max(frameStart + 1, Math.round(v)))} min={1} max={6000} step={1} accent={ACCENT} width={40} color={C.muted} />
      </div>
    </div>
  )
}
