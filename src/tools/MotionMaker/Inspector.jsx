// ── Motion Maker — Inspector (selected node params) ────────────────────────────
import { useRef } from 'react'
import { C, btn, Section, HexInput } from '../LogoMaker/ui.jsx'
import { NumberSlider } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'
import { NODE_DEFS, CATEGORY_COLOR } from './nodes.js'
import { processFile } from '../../lib/file.js'

const ACCENT = '#ff7849'

function ImageParam({ value, onChange }) {
  const inputRef = useRef(null)
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={async e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { const r = await processFile(f); if (r) onChange(r) } }}
        style={{
          height: 64, borderRadius: 4, border: `1px dashed ${C.border}`, cursor: 'pointer',
          background: C.ctrl, display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', position: 'relative',
        }}
      >
        {value?.dataUrl
          ? <img src={value.dataUrl} alt="" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 10, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="upload" size={14} /> drop / browse SVG·PNG</span>}
      </div>
      {value && (
        <button onClick={() => onChange(null)} style={{ ...btn(false), width: '100%', marginTop: 4, fontSize: 10, padding: '3px 0' }}>Clear</button>
      )}
      <input ref={inputRef} type="file" accept="image/*,.svg" hidden
        onChange={async e => { const f = e.target.files?.[0]; if (f) { const r = await processFile(f); if (r) onChange(r) } e.target.value = '' }} />
    </div>
  )
}

export default function Inspector({ node, boundKeys, onParam, onRemove }) {
  if (!node) {
    return (
      <div style={{ padding: 16, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
        Select a node to edit it.<br />
        <span style={{ color: C.dim }}>Drag from a node's value output (right dot) into a property socket (left dots) to animate it.</span>
      </div>
    )
  }
  const def = NODE_DEFS[node.type]
  const col = CATEGORY_COLOR[def.category] || ACCENT

  return (
    <div style={{ padding: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: col }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>{def.label}</span>
        <span style={{ fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: 1 }}>{def.category}</span>
        {node.type !== 'scene' && (
          <button onClick={() => onRemove(node.id)} title="Delete node"
            style={{ ...btn(false), marginLeft: 'auto', padding: '3px 6px', color: C.muted }}>
            <Icon name="delete" size={14} />
          </button>
        )}
      </div>

      <Section title="Parameters">
        {def.params.length === 0 && <div style={{ fontSize: 10, color: C.dim }}>No parameters.</div>}
        {def.params.map(p => {
          const bound = boundKeys.has(p.key)
          const val = node.params[p.key]
          if (p.type === 'image') return <ImageParam key={p.key} value={val} onChange={v => onParam(node.id, p.key, v)} />
          if (p.type === 'select') return (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, width: 60, flexShrink: 0 }}>{p.label}</span>
              <select value={val} onChange={e => onParam(node.id, p.key, e.target.value)}
                style={{ flex: 1, background: C.ctrl, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
                {p.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )
          if (p.type === 'color') return (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, width: 60 }}>{p.label}</span>
              <HexInput value={val} onChange={v => onParam(node.id, p.key, v)} />
            </div>
          )
          // number
          return (
            <div key={p.key} style={{ opacity: bound ? 0.45 : 1, position: 'relative' }} title={bound ? 'Driven by a value node' : ''}>
              <NumberSlider
                label={(bound ? '◆ ' : '') + p.label}
                min={p.min} max={p.max} step={p.step}
                value={typeof val === 'number' ? val : (p.default || 0)}
                onChange={v => onParam(node.id, p.key, v)}
                accent={col} labelWidth={78}
              />
            </div>
          )
        })}
      </Section>
    </div>
  )
}
