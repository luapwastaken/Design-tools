// ── Motion Maker — logo animation tool ─────────────────────────────────────────
//
// Node-graph motion design for logos. A deterministic engine evaluates the graph at
// the current frame; the Stage previews it, the Graph edits it, the Timeline scrubs
// it, and every exporter re-runs the same evaluation. See the design spec at
// docs/superpowers/specs/2026-06-14-motion-maker-design.md.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { C, btn, Section } from '../LogoMaker/ui.jsx'
import { HexInput } from '../LogoMaker/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { markSaved } from '../../lib/unsavedChanges.js'
import * as store from './store.js'
import { PRESETS, imagesFromDoc } from './presets.js'
import { exportGif, exportFramesZip, exportVideo, videoExtAvailable, downloadBlob } from './exporters.js'
import Stage from './Stage.jsx'
import Graph from './Graph.jsx'
import Timeline from './Timeline.jsx'
import Inspector from './Inspector.jsx'
import { useGlobalUndo } from '../../lib/undo.js'

const ACCENT = '#ff7849'

export default function MotionMaker() {
  const s = store.useMotion()
  const doc = s.doc

  const [tab, setTab] = useState('split')          // 'split' | 'stage' | 'graph'
  const [frame, setFrameRaw] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [exportBg, setExportBg] = useState('#ffffff')
  const [busy, setBusy] = useState(null)           // export label
  const [progress, setProgress] = useState(0)
  const [panelW, setPanelW] = useState(288)         // resizable left panel
  const [splitRatio, setSplitRatio] = useState(0.5) // resizable Stage|Graph split
  const contentRef = useRef(null)

  const clamp = (f) => Math.min(doc.frameEnd, Math.max(doc.frameStart, Math.round(f)))
  const setFrame = useCallback((f) => setFrameRaw(prev => clamp(typeof f === 'function' ? f(prev) : f)), [doc.frameStart, doc.frameEnd])

  // ── Incoming logo hand-off (read once on mount) ────────────────────────────────
  useEffect(() => {
    const payload = store.getIncomingLogo()
    if (payload) { store.applyIncomingLogo(payload); store.clearIncomingLogo(); setTab('stage'); setFrameRaw(0) }
  }, [])

  // ── Playback loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return
    let raf, last = performance.now(), acc = 0
    const spf = 1000 / (doc.fps || 30)
    const step = (now) => {
      acc += now - last; last = now
      while (acc >= spf) {
        acc -= spf
        setFrameRaw(prev => {
          let nf = prev + 1
          if (nf > doc.frameEnd) { if (loop) nf = doc.frameStart; else { nf = doc.frameEnd; setPlaying(false) } }
          return nf
        })
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, doc.fps, doc.frameStart, doc.frameEnd, loop])

  // ── Global undo/redo registration (Ctrl+Z / Ctrl+Y handled app-wide) ───────────
  useGlobalUndo(store.undo, store.redo)

  // ── Keyboard: Houdini transport ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const ctrl = e.ctrlKey || e.metaKey
      if (typing) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (ctrl) setFrame(doc.frameStart)
        else setFrame(f => f - (e.shiftKey ? 10 : 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (ctrl) setFrame(doc.frameEnd)
        else setFrame(f => f + (e.shiftKey ? 10 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc.frameStart, doc.frameEnd, setFrame])

  // keep frame in range when the range shrinks
  useEffect(() => { setFrameRaw(prev => clamp(prev)) }, [doc.frameStart, doc.frameEnd])

  // ── Selected node + its value bindings ─────────────────────────────────────────
  const selectedNode = doc.nodes.find(n => n.id === s.selectedId) || null
  const boundKeys = useMemo(() => {
    const set = new Set()
    if (!selectedNode) return set
    for (const e of doc.edges) {
      if (e.target === selectedNode.id && (e.targetHandle || '').startsWith('prop:')) set.add(e.targetHandle.slice(5))
    }
    return set
  }, [doc.edges, selectedNode])

  // ── Presets ────────────────────────────────────────────────────────────────────
  function applyPreset(preset) {
    store.applyPreset(preset, imagesFromDoc(doc))
    setFrameRaw(0); setPlaying(true)
  }

  // ── Project (session) save / load — the whole doc is the project ───────────────
  const [savedProj, setSavedProj] = useState(false)
  async function saveProject() {
    const data = JSON.stringify({ doc }, null, 2)
    if (window.electron) await window.electron.saveSession('motion-maker', data)
    else { try { localStorage.setItem('designtools-motion-project', data) } catch {} }
    markSaved('motion-maker'); setSavedProj(true); setTimeout(() => setSavedProj(false), 2000)
  }
  async function loadProject() {
    let data = null
    if (window.electron) data = await window.electron.loadSession('motion-maker')
    else data = localStorage.getItem('designtools-motion-project')
    if (data) { try { const p = JSON.parse(data); if (p.doc) { store.loadDoc(p.doc); setFrameRaw(0); setPlaying(false) } } catch {} }
  }

  // ── Export ─────────────────────────────────────────────────────────────────────
  const videoExt = videoExtAvailable()
  async function runExport(kind) {
    if (busy) return
    const wasPlaying = playing; setPlaying(false)
    setBusy(kind); setProgress(0)
    try {
      if (kind === 'gif') {
        const blob = await exportGif(doc, { bg: exportBg }, setProgress)
        if (blob) downloadBlob(blob, 'motion.gif')
      } else if (kind === 'frames') {
        const blob = await exportFramesZip(doc, setProgress)
        downloadBlob(blob, 'motion-frames.zip')
      } else if (kind === 'video') {
        const { blob, ext } = await exportVideo(doc, { bg: exportBg }, setProgress)
        downloadBlob(blob, 'motion.' + ext)
      }
    } catch (err) {
      console.error('[MotionMaker] export failed', err)
    } finally {
      setBusy(null); setProgress(0); if (wasPlaying) setPlaying(true)
    }
  }

  // ── Resizable panes ────────────────────────────────────────────────────────────
  function startPanelResize(e) {
    e.preventDefault()
    const sx = e.clientX, sw = panelW
    const mv = e2 => setPanelW(Math.min(460, Math.max(240, sw + e2.clientX - sx)))
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
  }
  function startSplitResize(e) {
    e.preventDefault()
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return
    const mv = e2 => setSplitRatio(Math.min(0.82, Math.max(0.18, (e2.clientX - rect.left) / rect.width)))
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
  }

  const tabBtn = (id, label, icon) => (
    <button onClick={() => setTab(id)} style={{
      ...btn(false), display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
      background: tab === id ? C.ctrl : 'transparent', color: tab === id ? ACCENT : C.muted,
      borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent', borderRadius: 0,
    }}><Icon name={icon} size={14} />{label}</button>
  )

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, overflow: 'hidden' }}>
      {/* ── Left panel (resizable) ── */}
      <div style={{ width: panelW, minWidth: panelW, background: C.panel, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        <div onMouseDown={startPanelResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 10 }} />
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: 2, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="movie_filter" size={16} color={ACCENT} /> Motion Maker
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 20px' }}>
          <Section title="Presets">
            <PresetStrip
              presetId={s.presetId} savedPresets={s.savedPresets}
              onApply={applyPreset}
              onSave={name => store.saveCurrentPreset(name)}
              onDelete={id => store.removeSavedPreset(id)}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => store.arrangeLockup()} style={{ ...btn(false), flex: 1, fontSize: 10 }} title="Position icon + wordmark as a lockup">
                Arrange lockup
              </button>
              <button onClick={() => { store.resetDoc(); setFrameRaw(0); setPlaying(false) }} style={{ ...btn(false), fontSize: 10, display: 'flex', alignItems: 'center', gap: 6 }} title="Reset graph">
                <Icon name="restart_alt" size={13} /> Reset
              </button>
            </div>
          </Section>

          <Section title="Project">
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveProject} style={{ ...btn(savedProj), flex: 1, fontSize: 10 }}>{savedProj ? '✓ Saved' : 'Save project'}</button>
              <button onClick={loadProject} style={{ ...btn(false), flex: 1, fontSize: 10 }}>Load</button>
            </div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>Saves the whole graph + timeline. Auto-saved continuously too.</div>
          </Section>

          <div style={{ borderTop: `1px solid ${C.border}`, margin: '0 -16px' }}>
            <Inspector node={selectedNode} boundKeys={boundKeys} onParam={store.updateNodeParam} onRemove={store.removeNode} />
          </div>

          <Section title="Export">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, width: 64 }}>Matte</span>
              <HexInput value={exportBg} onChange={setExportBg} />
            </div>
            <div style={{ fontSize: 9, color: C.dim, marginBottom: 8, lineHeight: 1.5 }}>Matte used for GIF / video. PNG frames keep transparency.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button disabled={!!busy} onClick={() => runExport('gif')} style={{ ...btn(busy === 'gif'), padding: '7px 0' }}>{busy === 'gif' ? pctLabel(progress) : 'GIF'}</button>
              <button disabled={!!busy} onClick={() => runExport('frames')} style={{ ...btn(busy === 'frames'), padding: '7px 0' }}>{busy === 'frames' ? pctLabel(progress) : 'PNG seq'}</button>
              <button disabled={!!busy || !videoExt} onClick={() => runExport('video')} style={{ ...btn(busy === 'video'), gridColumn: '1 / 3', padding: '7px 0' }}>
                {busy === 'video' ? pctLabel(progress) : (videoExt ? `Video (.${videoExt})` : 'Video (unavailable)')}
              </button>
            </div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>Lottie + dedicated MP4 (ffmpeg) — coming in a later phase.</div>
          </Section>
        </div>
      </div>

      {/* ── Center: tabs + content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 38, flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.panel, display: 'flex', alignItems: 'stretch', padding: '0 8px', gap: 2 }}>
          {tabBtn('split', 'Split', 'movie')}
          {tabBtn('stage', 'Stage', 'image')}
          {tabBtn('graph', 'Graph', 'account_tree')}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => store.undo()} disabled={!store.canUndo()} title="Undo (Ctrl+Z)" style={{ ...btn(false), padding: '4px 7px', opacity: store.canUndo() ? 1 : 0.4 }}><Icon name="undo" size={14} /></button>
            <button onClick={() => store.redo()} disabled={!store.canRedo()} title="Redo (Ctrl+Y)" style={{ ...btn(false), padding: '4px 7px', opacity: store.canRedo() ? 1 : 0.4 }}><Icon name="redo" size={14} /></button>
          </div>
        </div>

        <div ref={contentRef} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {tab === 'stage' && <Stage doc={doc} frame={frame} />}
          {tab === 'graph' && <Graph doc={doc} selectedId={s.selectedId} />}
          {tab === 'split' && (
            <>
              <div style={{ width: `${splitRatio * 100}%`, minWidth: 0, display: 'flex' }}>
                <Stage doc={doc} frame={frame} />
              </div>
              <div onMouseDown={startSplitResize} title="Drag to resize"
                style={{ width: 6, flexShrink: 0, cursor: 'col-resize', background: C.border, position: 'relative' }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                <Graph doc={doc} selectedId={s.selectedId} />
              </div>
            </>
          )}
        </div>

        <Timeline
          frame={frame} setFrame={setFrame}
          playing={playing} setPlaying={setPlaying}
          loop={loop} setLoop={setLoop}
          fps={doc.fps} setFps={v => store.patchDoc({ fps: v })}
          frameStart={doc.frameStart} frameEnd={doc.frameEnd}
          setFrameStart={v => store.patchDoc({ frameStart: v })}
          setFrameEnd={v => store.patchDoc({ frameEnd: v })}
          markers={doc.nodes.filter(n => n.type === 'marker' && !n.bypass).map(n => ({ id: n.id, frame: n.params?.frame || 0, label: n.params?.label || '', color: n.params?.color || '#22d3ee' }))}
        />
      </div>
    </div>
  )
}

const pctLabel = (p) => `${Math.round(p * 100)}%`

function StepBtn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, width: 22, height: 26, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>{children}</button>
}

// Preset picker mirroring the Dither tool: ‹ dropdown › + scroll-wheel to flip
// through, with position / total readout and inline save / delete.
function PresetStrip({ presetId, savedPresets, onApply, onSave, onDelete }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const all = [...PRESETS, ...savedPresets]
  const idx = all.findIndex(p => p.id === presetId)
  const current = idx >= 0 ? all[idx] : null
  const groups = [{ label: 'Built-in', items: PRESETS }]
  if (savedPresets.length) groups.push({ label: 'Saved', items: savedPresets })
  const step = d => { if (!all.length) return; onApply(all[(idx < 0 ? 0 : (idx + d + all.length) % all.length)]) }
  const selectStyle = { flex: 1, minWidth: 0, background: C.ctrl, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }

  return (
    <div>
      <div onWheel={e => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1) }} style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Scroll or ‹ › to flip through">
        <StepBtn onClick={() => step(-1)}>‹</StepBtn>
        <select value={presetId || ''} onChange={e => { const p = all.find(x => x.id === e.target.value); if (p) onApply(p) }} style={selectStyle}>
          {!current && <option value="">— Custom —</option>}
          {groups.map(g => <optgroup key={g.label} label={g.label}>{g.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select>
        <StepBtn onClick={() => step(1)}>›</StepBtn>
      </div>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
        {current ? `${idx + 1} / ${all.length} · ${idx < PRESETS.length ? 'Built-in' : 'Saved'}` : `Custom · ${all.length} presets`}
      </div>
      {naming ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Preset name…"
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); setNaming(false); setName('') } if (e.key === 'Escape') setNaming(false) }}
            style={{ flex: 1, minWidth: 0, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '3px 6px', fontSize: 10, outline: 'none', fontFamily: 'inherit' }} />
          <button onClick={() => { if (name.trim()) { onSave(name.trim()); setNaming(false); setName('') } }} style={{ ...btn(true), fontSize: 10 }}>Save</button>
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <button onClick={() => setNaming(true)} style={{ ...btn(false), flex: 1, fontSize: 10 }}>+ Save current as preset</button>
          {current && savedPresets.some(p => p.id === current.id) && (
            <button onClick={() => onDelete(current.id)} style={{ ...btn(false), padding: '0 8px' }} title="Delete preset"><Icon name="delete" size={12} /></button>
          )}
        </div>
      )}
    </div>
  )
}
