import { useState, useEffect, useRef } from 'react'
import {
  usePalette, setMode, setValueLock, setHueLock,
  updateSwatch, addSwatch, removeSwatch, duplicateSwatch,
  reorderSwatches, setActive, sendToTool,
  toggleSelected, setSelected, clearSelected, bulkRemove, bulkUpdate,
  undo, redo, getState,
  resetPalette, clearPalette,
} from './store.js'
import { useUi, setUi, getUi, resetLayout } from './uiState.js'
import { oklchToHex, autoName } from '../../lib/color.js'
import { pickScreenColor, eyeDropperSupported } from '../../lib/eyedropper.js'
import { useGlobalUndo } from '../../lib/undo.js'
import Icon from '../../components/Icon.jsx'
import Picker from './Picker.jsx'
import DesignMode from './DesignMode.jsx'
import IllustrationMode from './IllustrationMode.jsx'
import PrintPanel from './PrintPanel.jsx'
import ExportPanel from './ExportPanel.jsx'
import { T, MiniBtn, IconBtn, Input, Select, Btn, ResetBtn } from './panelUi.jsx'
import colorNames from '../../data/colorNames.json'
import './colorpalette.css'

// Re-exported because ExportPanel and PrintPanel import `C` from here. The
// values now come from tokens.js — this is the compatibility shim, not a
// second palette.
export const C = T

const SWATCH_SZ = 76
const ROLES = ['black', 'main', 'accent', 'white', 'pop', 'freeform']

// ── The four views ────────────────────────────────────────────────────────────
//
// Design and Illustration used to be one kind of tab (exclusive modes) sitting
// in the same bar as Print and Export, which were a different kind (toggles that
// replaced the pane and un-toggled on a second click). Same styling, two
// interaction models, and clicking Print left Design still looking selected.
//
// They are all just views of the palette, so they are all one radio group now.
const VIEWS = [
  { id: 'design',       label: 'Design',       kind: 'edit' },
  { id: 'illustration', label: 'Illustration', kind: 'edit' },
  { id: 'print',        label: 'Print',        kind: 'output' },
  { id: 'export',       label: 'Export',       kind: 'output' },
]

export default function ColorPalette() {
  const { swatches, active, mode, valueLockEnabled, hueLockEnabled, selected } = usePalette()
  const ui = useUi()
  const activeSwatch = swatches.find(s => s.id === active)
  const [dragIdx, setDragIdx] = useState(null)

  const view = ui.view
  const greyColors = ui.greyscale
  // Which of the four tabs reads as current.
  const currentTab = view === 'palette' ? mode : view

  const L_MIN = 252, L_MAX = 500
  const D_MIN = 140, D_MAX = 620

  useGlobalUndo(undo, redo)

  useEffect(() => {
    function onKey(e) {
      const ctrl = e.ctrlKey || e.metaKey
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' || el.isContentEditable)
      if (ctrl || typing) return
      if (e.key === 'y' || e.key === 'Y') setUi({ greyscale: !getUi().greyscale })
      // Global eyedropper — press I anywhere to grab a colour from screen
      // and drop it onto the active swatch.
      if ((e.key === 'i' || e.key === 'I') && eyeDropperSupported()) {
        e.preventDefault()
        pickScreenColor().then(hex => {
          if (!hex) return
          const { active } = getState()
          if (active) updateSwatch(active, { hex })
          else addSwatch(hex)
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onPaste(e) {
      // Only claim the paste when it isn't destined for a field. Without this
      // guard, pasting a hex into the Picker's own hex box applied it twice —
      // once by the field, once here — and pasting anything hex-shaped into the
      // swatch NAME box silently changed the colour instead of the name.
      const el = e.target
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

      const text = e.clipboardData?.getData('text') ?? ''
      if (!text) return
      const colors = parseColorList(text)
      if (colors.length === 1 && activeSwatch) {
        updateSwatch(activeSwatch.id, { hex: colors[0] })
      } else if (colors.length > 1) {
        for (const hex of colors) addSwatch(hex)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [active, activeSwatch])

  const colorFilter = greyColors ? { filter: 'grayscale(1)' } : {}
  const isEditing = view === 'palette'

  function pickTab(t) {
    if (t.kind === 'edit') { setMode(t.id); setUi({ view: 'palette', mode: t.id }) }
    else setUi({ view: t.id })
  }

  return (
    <div className="cp" style={{
      display: 'flex', height: '100%', overflow: 'hidden',
    }}>

      {/* ── Left: Picker column ─────────────────────────────────── */}
      <div style={{
        width: ui.leftWidth, flexShrink: 0,
        background: T.sidebar, display: 'flex', flexDirection: 'column',
        padding: '14px 16px', gap: 12, overflow: 'hidden',
      }}>
        {activeSwatch && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="cp-sw" style={{
              width: 44, height: 44, borderRadius: T.rLg, background: activeSwatch.hex,
              border: `2px solid ${T.accent}`, flexShrink: 0, ...colorFilter,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: T.body, color: T.text, fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {activeSwatch.name || 'Unnamed'}
              </div>
              <div className="cp-num" style={{ fontSize: T.label, color: T.muted }}>
                {activeSwatch.hex}
              </div>
            </div>
          </div>
        )}

        <div style={colorFilter}>
          <Picker
            oklch={activeSwatch?.oklch}
            onChange={oklch => activeSwatch && updateSwatch(activeSwatch.id, { oklch })}
            valueLocked={valueLockEnabled}
            hueLocked={hueLockEnabled}
          />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <LockBtn
            label={<><Icon name="lock" size={12} /> Value</>}
            checked={valueLockEnabled} onChange={setValueLock}
            title="Value lock — hold the perceived (greyscale) value steady as you change hue or chroma" />
          <LockBtn
            label={<><Icon name="lock" size={12} /> Hue</>}
            checked={hueLockEnabled} onChange={setHueLock}
            title="Hue lock — freeze H across all inputs" />
          <LockBtn
            label="Greyscale" checked={greyColors}
            onChange={v => setUi({ greyscale: v })}
            title="Greyscale preview — see the palette's value structure with hue removed (Y)" />
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <div className="cp-micro" style={{ marginBottom: 6 }}>Send to</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn style={{ flex: 1, padding: '6px 4px' }}
              onClick={() => sendToTool('logo-maker', swatches.map(s => s.hex))}>Logo</Btn>
            <Btn style={{ flex: 1, padding: '6px 4px' }}
              onClick={() => sendToTool('pattern-maker', swatches.map(s => s.hex))}>Pattern</Btn>
            <Btn style={{ flex: 1, padding: '6px 4px' }}
              onClick={() => sendToTool('dither-maker',
                (selected.length ? swatches.filter(s => selected.includes(s.id)) : swatches).map(s => s.hex))}>Dither</Btn>
          </div>
          <div className="cp-hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
            <kbd style={kbd}>Ctrl</kbd>+<kbd style={kbd}>V</kbd> paste colours
            {eyeDropperSupported() && <> · <kbd style={kbd}>I</kbd> pick from screen</>}
            {' '}· <kbd style={kbd}>Y</kbd> greyscale
          </div>
        </div>
      </div>

      <Splitter axis="x" onDelta={d => setUi({ leftWidth: clamp(ui.leftWidth + d, L_MIN, L_MAX) })} />

      {/* ── Right: Main content ─────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        <div role="tablist" aria-label="Palette view" style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px',
          borderBottom: `1px solid ${T.line}`, background: T.sidebar, flexShrink: 0,
        }}>
          {VIEWS.map((t, i) => (
            <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Editing views and output views are the same kind of control —
                  a separator is enough to say which pair does what. */}
              {i > 0 && VIEWS[i - 1].kind !== t.kind && (
                <span aria-hidden style={{ width: 1, height: 18, background: T.line, margin: '0 8px' }} />
              )}
              <button type="button" role="tab"
                aria-selected={currentTab === t.id}
                onClick={() => pickTab(t)}
                className={currentTab === t.id ? 'cp-chip is-active' : 'cp-chip'}
                style={{ padding: '6px 14px', fontSize: T.body }}
              >{t.label}</button>
            </span>
          ))}
        </div>

        {view === 'print' && <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}><PrintPanel /></div>}
        {view === 'export' && <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}><ExportPanel /></div>}

        {isEditing && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

            {/* ═══ PALETTE — now the largest thing on screen ═══
                It was a 164px strip that scrolled internally while the tool
                panels below took every remaining pixel: the document was the
                smallest element in its own editor. It grows first now, and the
                panels live in a drawer sized to what you're doing. */}
            <div style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
                <span className="cp-micro">
                  {swatches.length} swatch{swatches.length === 1 ? '' : 'es'}
                </span>
                <span className="cp-hint">
                  {/* Multi-select existed but nothing on screen said so. */}
                  <kbd style={kbd}>Ctrl</kbd>+click to add to a selection ·
                  {' '}<kbd style={kbd}>Shift</kbd>+click for a range
                </span>
                <span style={{ flex: 1 }} />
                <ResetBtn label="Reset panes" icon={false}
                  title="Put the picker column and tool drawer back to their default sizes"
                  onReset={resetLayout} />
                <ResetBtn label="Clear" icon={false} confirmLabel="Delete all?"
                  disabled={!swatches.length}
                  title="Remove every swatch — this cannot be undone with Ctrl+Z"
                  onReset={clearPalette} />
                <ResetBtn label="Reset palette"
                  title="Back to the four starting swatches. Your locks and print profile are kept."
                  onReset={resetPalette} />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                {swatches.map((sw, idx) => (
                  <SwatchCard
                    key={sw.id}
                    swatch={sw}
                    isActive={sw.id === active}
                    isSelected={selected.includes(sw.id)}
                    colorFilter={colorFilter}
                    onClick={e => {
                      if (e.ctrlKey || e.metaKey) { toggleSelected(sw.id); setActive(sw.id) }
                      else if (e.shiftKey) {
                        const anchorIdx = swatches.findIndex(s => s.id === active)
                        const min = Math.min(anchorIdx, idx), max = Math.max(anchorIdx, idx)
                        setSelected(swatches.slice(min, max + 1).map(s => s.id))
                      } else { setActive(sw.id); clearSelected() }
                    }}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      if (dragIdx !== null && dragIdx !== idx) reorderSwatches(dragIdx, idx)
                      setDragIdx(null)
                    }}
                    onDragEnd={() => setDragIdx(null)}
                  />
                ))}
                <button type="button"
                  onClick={() => addSwatch('#808080')}
                  title="Add a swatch"
                  className="cp-btn"
                  style={{
                    width: SWATCH_SZ, height: SWATCH_SZ, borderRadius: 10,
                    background: 'transparent', borderStyle: 'dashed',
                    fontSize: 26, flexShrink: 0, alignSelf: 'flex-start', padding: 0,
                  }}
                >+</button>
              </div>
            </div>

            {selected.length > 1 && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '8px 16px', borderTop: `1px solid ${T.accentLine}`,
                background: T.accentSoft, flexShrink: 0,
              }}>
                <span style={{ fontSize: T.body, color: T.accentText, fontWeight: 600 }}>
                  {selected.length} selected
                </span>
                <div style={{ flex: 1 }} />
                <MiniBtn onClick={() => swatches.filter(s => selected.includes(s.id))
                  .forEach(s => updateSwatch(s.id, { name: autoName(s.hex, colorNames) }))}>
                  Auto name
                </MiniBtn>
                <Select defaultValue="" style={{ padding: '4px 7px', fontSize: T.label }}
                  onChange={e => { if (e.target.value) { bulkUpdate(selected, { role: e.target.value }); e.target.value = '' } }}>
                  <option value="" disabled>Set role…</option>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
                <MiniBtn variant="danger" onClick={() => bulkRemove(selected)}>
                  Delete {selected.length}
                </MiniBtn>
                <MiniBtn onClick={clearSelected}>Clear</MiniBtn>
              </div>
            )}

            {activeSwatch && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '9px 16px', borderTop: `1px solid ${T.line}`,
                flexShrink: 0, background: T.panel,
              }}>
                <Input
                  value={activeSwatch.name}
                  onChange={e => updateSwatch(activeSwatch.id, { name: e.target.value })}
                  placeholder="Name this colour…"
                  aria-label="Swatch name"
                  style={{ width: 180 }}
                />
                <MiniBtn title="Name this swatch from the nearest known colour"
                  onClick={() => updateSwatch(activeSwatch.id, { name: autoName(activeSwatch.hex, colorNames) })}>
                  Auto
                </MiniBtn>
                <MiniBtn title="Name every swatch in the palette"
                  onClick={() => swatches.forEach(sw => updateSwatch(sw.id, { name: autoName(sw.hex, colorNames) }))}>
                  Name all
                </MiniBtn>
                <div style={{ flex: 1 }} />
                <Select value={activeSwatch.role} aria-label="Swatch role"
                  style={{ padding: '5px 8px', fontSize: T.label }}
                  onChange={e => updateSwatch(activeSwatch.id, { role: e.target.value })}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
                <IconBtn title={activeSwatch.locked ? 'Unlock colour' : 'Lock colour — prevent edits'}
                  onClick={() => updateSwatch(activeSwatch.id, { locked: !activeSwatch.locked })}>
                  <Icon name={activeSwatch.locked ? 'lock' : 'lock_open'} size={15} />
                </IconBtn>
                <IconBtn title="Duplicate" onClick={() => duplicateSwatch(activeSwatch.id)}>
                  <Icon name="content_copy" size={15} />
                </IconBtn>
                <IconBtn danger title="Remove" onClick={() => removeSwatch(activeSwatch.id)}>
                  <Icon name="close" size={15} />
                </IconBtn>
              </div>
            )}

            {/* ── Tool drawer ──
                The panels live here rather than owning the lower half outright,
                so the palette above keeps whatever room is left. The height is
                remembered across sessions; collapsing hands the whole pane to
                the swatches when you just want to look at colours. */}
            {ui.drawerOpen && (
              <Splitter axis="y" onDelta={d => setUi({ drawerH: clamp(ui.drawerH - d, D_MIN, D_MAX) })} />
            )}
            <div style={{
              height: ui.drawerOpen ? ui.drawerH : 'auto',
              flexShrink: 0, display: 'flex', flexDirection: 'column',
              background: T.panel, minHeight: 0, position: 'relative',
              borderTop: ui.drawerOpen ? 'none' : `1px solid ${T.line}`,
            }}>
              {ui.drawerOpen ? (
                <>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    {mode === 'design' ? <DesignMode /> : <IllustrationMode />}
                  </div>
                  <IconBtn
                    title="Collapse tools"
                    onClick={() => setUi({ drawerOpen: false })}
                    style={{ position: 'absolute', top: 5, right: 8, zIndex: 2 }}
                  >
                    <Icon name="expand_more" size={16} />
                  </IconBtn>
                </>
              ) : (
                <button type="button"
                  onClick={() => setUi({ drawerOpen: true })}
                  aria-expanded={false}
                  className="cp-btn cp-btn--ghost"
                  style={{
                    justifyContent: 'flex-start', gap: 10, height: 36,
                    borderRadius: 0, padding: '0 12px', width: '100%',
                  }}>
                  <Icon name="expand_less" size={16} />
                  <span className="cp-micro">Tools</span>
                  <span className="cp-label" style={{ color: T.faint }}>
                    {mode === 'design' ? ui.panel : ui.illPanel}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const kbd = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11, background: '#1a1a22', border: `1px solid ${'#26262f'}`,
  borderRadius: 3, padding: '1px 4px', color: '#9e9e9e',
}

// ── Swatch card ───────────────────────────────────────────────────────────────

function SwatchCard({ swatch, isActive, isSelected, colorFilter, onClick, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const [hover, setHover] = useState(false)
  const border = isActive ? `3px solid ${T.accent}`
    : isSelected ? `2px dashed ${T.accent}`
    : hover ? `2px solid ${T.lineHi}`
    : '2px solid transparent'

  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${swatch.name || 'Unnamed'} — ${swatch.hex}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer', flexShrink: 0, width: SWATCH_SZ }}
    >
      <div className="cp-sw" style={{
        width: SWATCH_SZ, height: SWATCH_SZ,
        borderRadius: 10, background: swatch.hex,
        border, boxSizing: 'border-box', position: 'relative',
        ...colorFilter,
      }}>
        {swatch.locked && (
          <div title="Locked" style={{
            position: 'absolute', bottom: 4, right: 4,
            width: 16, height: 16, borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="lock" size={10} color="rgba(255,255,255,0.85)" />
          </div>
        )}
      </div>
      <div style={{
        fontSize: T.label, color: isActive ? T.text : T.muted,
        textAlign: 'center', width: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {swatch.name || swatch.hex}
      </div>
    </div>
  )
}

function LockBtn({ label, checked, onChange, title }) {
  return (
    <button type="button" title={title} onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={checked ? 'cp-chip is-active' : 'cp-chip'}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {label}
    </button>
  )
}

// ── Splitter ──────────────────────────────────────────────────────────────────
//
// One component for both axes; the old pair were near-identical copies. The hit
// area is 9px with a visible grip — the 5px versions were, in Kimi's words on
// reviewing this tool, "nearly impossible to grab", which is also why the
// palette never got resized.

function Splitter({ axis, onDelta }) {
  const dragging = useRef(false)
  const last = useRef(0)
  const [hot, setHot] = useState(false)
  const horiz = axis === 'x'

  return (
    <div
      role="separator"
      aria-orientation={horiz ? 'vertical' : 'horizontal'}
      onPointerDown={e => {
        dragging.current = true
        last.current = horiz ? e.clientX : e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
        setHot(true)
      }}
      onPointerMove={e => {
        if (!dragging.current) return
        const pos = horiz ? e.clientX : e.clientY
        const d = pos - last.current
        last.current = pos
        if (d) onDelta(d)
      }}
      onPointerUp={() => { dragging.current = false; setHot(false) }}
      onPointerCancel={() => { dragging.current = false; setHot(false) }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => { if (!dragging.current) setHot(false) }}
      style={{
        [horiz ? 'width' : 'height']: 9,
        flexShrink: 0, zIndex: 10,
        cursor: horiz ? 'col-resize' : 'row-resize',
        background: hot ? T.accentSoft : T.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.12s',
      }}
    >
      <div style={{
        [horiz ? 'width' : 'height']: 1,
        [horiz ? 'height' : 'width']: horiz ? 28 : 40,
        background: hot ? T.accent : T.line,
        borderRadius: 1, transition: 'background 0.12s',
      }} />
    </div>
  )
}

// ── Smart paste: detect hex, rgb(), oklch(), oklab(), or comma/newline list ───

function parseColorList(text) {
  const hexes = []
  const tokens = text.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean)
  for (const tok of tokens) {
    const hex = tryParseToHex(tok)
    if (hex) hexes.push(hex)
  }
  if (!hexes.length) {
    const hex = tryParseToHex(text.trim())
    if (hex) hexes.push(hex)
  }
  return hexes
}

function tryParseToHex(str) {
  if (!str) return null
  const short = str.match(/^#?([0-9a-fA-F]{3})$/)
  if (short) {
    const [, h] = short
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  }
  const full = str.match(/^#?([0-9a-fA-F]{6})$/)
  if (full) return `#${full[1]}`
  const rgb = str.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number)
    return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
  }
  const oklch = str.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i)
  if (oklch) {
    try { return oklchToHex(+oklch[1], +oklch[2], +oklch[3]) } catch {}
  }
  return null
}
