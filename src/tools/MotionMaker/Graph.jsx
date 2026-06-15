// ── Motion Maker — node editor (React Flow) ────────────────────────────────────
import { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, Panel } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { C } from '../LogoMaker/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { NODE_DEFS, NODE_TYPES, CATEGORY_COLOR, makeNodeId } from './nodes.js'
import * as store from './store.js'

const NODE_W = 190, HEADER_H = 28, ROW_H = 20

// Which params get a wireable socket (numbers are drivable by value nodes).
const socketParams = (def) => def.params.filter(p => p.type === 'number')

// ── Generic node component (one component renders every node type) ───────────────
function MotionNode({ id, data, selected }) {
  const def = NODE_DEFS[data.type]
  const col = CATEGORY_COLOR[def.category]
  const rows = socketParams(def)
  const summary = data.summary

  return (
    <div style={{
      width: NODE_W, background: C.panel, borderRadius: 6,
      border: `1px solid ${selected ? col : C.border}`,
      boxShadow: selected ? `0 0 0 1px ${col}` : 'none', fontFamily: 'inherit',
    }}>
      <div style={{
        height: HEADER_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
        borderBottom: `1px solid ${C.border}`, background: C.ctrl, borderRadius: '6px 6px 0 0',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: col, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{def.label}</span>
      </div>

      {/* object input / output + value output handles (header level) */}
      {def.obj.in && <Handle type="target" position={Position.Left} id="objin" style={{ top: HEADER_H / 2, width: 9, height: 9, background: '#5ab4ff', border: 'none' }} />}
      {def.obj.out && <Handle type="source" position={Position.Right} id="objout" style={{ top: HEADER_H / 2, width: 9, height: 9, background: '#5ab4ff', border: 'none' }} />}
      {def.value && <Handle type="source" position={Position.Right} id="valout" style={{ top: HEADER_H / 2, width: 9, height: 9, background: CATEGORY_COLOR.value, border: 'none' }} />}

      {/* body */}
      <div style={{ padding: '4px 0' }}>
        {def.value && (
          <div style={{ padding: '2px 10px', fontSize: 10, color: CATEGORY_COLOR.value, fontVariantNumeric: 'tabular-nums' }}>{summary}</div>
        )}
        {rows.map((p, i) => (
          <div key={p.key} style={{ position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px' }}>
            <Handle type="target" position={Position.Left} id={`prop:${p.key}`}
              style={{ top: ROW_H / 2, left: -4, width: 7, height: 7, background: data.boundKeys?.has(p.key) ? CATEGORY_COLOR.value : C.dim, border: `1px solid ${C.border}` }} />
            <span style={{ fontSize: 10, color: data.boundKeys?.has(p.key) ? CATEGORY_COLOR.value : C.muted }}>{p.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
              {data.boundKeys?.has(p.key) ? '◆' : (typeof data.params[p.key] === 'number' ? round(data.params[p.key]) : '')}
            </span>
          </div>
        ))}
        {def.params.some(p => p.type === 'image') && (
          <div style={{ padding: '2px 10px 4px' }}>
            {data.params.image?.dataUrl
              ? <img src={data.params.image.dataUrl} alt="" style={{ width: '100%', height: 40, objectFit: 'contain', opacity: 0.9 }} />
              : <div style={{ height: 26, border: `1px dashed ${C.dim}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: C.dim }}>no image</div>}
          </div>
        )}
      </div>
    </div>
  )
}

const round = (v) => Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100

const nodeTypes = { motionNode: MotionNode }

// ── Value-node one-line summary for the node body ────────────────────────────────
function summarize(node) {
  const p = node.params
  if (node.type === 'ramp') return `${p.from}→${p.to} · f${p.startFrame}-${p.endFrame}`
  if (node.type === 'lfo') return `${p.wave} · T${p.period} · ±${p.amp}`
  if (node.type === 'spring') return `${p.from}→${p.to} · k${p.stiffness}`
  if (node.type === 'constant') return `${p.value}`
  if (node.type === 'time') return `${p.mode} · ×${p.scale}`
  if (node.type === 'noise') return `f${p.frequency} · ±${p.amplitude}`
  if (node.type === 'pulse') return `${p.shape} · every ${p.interval}f`
  if (node.type === 'randomHold') return `${p.min}–${p.max} · ${p.interval}f`
  if (node.type === 'keyframes') return `${(p.keys || []).length} keys · ${p.extrapolate}`
  if (node.type === 'math') return `A ${p.op} B`
  if (node.type === 'mapRange') return `→ [${p.outMin}, ${p.outMax}]`
  if (node.type === 'curve') return `${p.ease}`
  if (node.type === 'mix') return `${p.mode} · t${p.t}`
  if (node.type === 'clamp') return `[${p.min}, ${p.max}]${p.steps > 1 ? ' /' + p.steps : ''}`
  return ''
}

export default function Graph({ doc, selectedId }) {
  // bound keys per node (which props are driven by a value edge)
  const boundByNode = useMemo(() => {
    const m = {}
    for (const e of doc.edges) {
      if ((e.targetHandle || '').startsWith('prop:')) {
        (m[e.target] ||= new Set()).add(e.targetHandle.slice(5))
      }
    }
    return m
  }, [doc.edges])

  const rfNodes = useMemo(() => doc.nodes.map(n => ({
    id: n.id, type: 'motionNode', position: n.pos, selected: n.id === selectedId,
    data: { type: n.type, params: n.params, boundKeys: boundByNode[n.id] || new Set(), summary: summarize(n) },
  })), [doc.nodes, selectedId, boundByNode])

  const rfEdges = useMemo(() => doc.edges.map(e => ({
    ...e,
    style: { stroke: e.sourceHandle === 'valout' ? CATEGORY_COLOR.value : '#5ab4ff', strokeWidth: 1.5 },
  })), [doc.edges])

  const onNodesChange = useCallback((changes) => {
    let nodes = store.getState().doc.nodes
    let dirty = false, committed = false
    for (const c of changes) {
      if (c.type === 'position' && c.position) { nodes = nodes.map(n => n.id === c.id ? { ...n, pos: c.position } : n); dirty = true; if (c.dragging === false) committed = true }
      else if (c.type === 'remove') { store.removeNode(c.id); return }
      else if (c.type === 'select' && c.selected) { store.setSelected(c.id) }
    }
    if (dirty) store.setNodes(nodes)
    if (committed) store.commitHistory()
  }, [])

  const onEdgesChange = useCallback((changes) => {
    let edges = store.getState().doc.edges
    let dirty = false
    for (const c of changes) {
      if (c.type === 'remove') { edges = edges.filter(e => e.id !== c.id); dirty = true }
    }
    if (dirty) store.setEdges(edges)
  }, [])

  const onConnect = useCallback((conn) => {
    const edge = { id: makeNodeId('edge'), source: conn.source, target: conn.target, sourceHandle: conn.sourceHandle, targetHandle: conn.targetHandle }
    // a property socket only accepts one driver — replace any existing
    const existing = store.getState().doc.edges.filter(e =>
      !(e.target === conn.target && e.targetHandle === conn.targetHandle && conn.targetHandle?.startsWith('prop:')))
    store.setEdges([...existing, edge])
    store.commitHistory()
  }, [])

  const isValidConnection = useCallback((conn) => {
    if (conn.source === conn.target) return false
    const objToObj = conn.sourceHandle === 'objout' && conn.targetHandle === 'objin'
    const valToProp = conn.sourceHandle === 'valout' && (conn.targetHandle || '').startsWith('prop:')
    return objToObj || valToProp
  }, [])

  // ── Add-node command palette (Tab to open, like Post FX) ───────────────────────
  const wrapRef = useRef(null)
  const rfRef = useRef(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Tab' || paletteOpen) return
      const ae = document.activeElement
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)
      if (typing) return
      e.preventDefault()
      setPaletteOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen])

  const addAtCenter = useCallback((type) => {
    let pos = { x: 260 + Math.random() * 120, y: 140 + Math.random() * 120 }
    const inst = rfRef.current, wrap = wrapRef.current
    if (inst && wrap) {
      const r = wrap.getBoundingClientRect()
      try { pos = inst.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) } catch {}
    }
    store.addNode(type, pos)
    setPaletteOpen(false)
  }, [])

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: 'relative', background: '#0d0d10' }}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onInit={inst => { rfRef.current = inst }}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} isValidConnection={isValidConnection}
        onPaneClick={() => store.setSelected(null)}
        defaultViewport={doc.view} minZoom={0.2} maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
      >
        <Background color={C.border} gap={20} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => store.tidyGraph()}
              style={{ fontSize: 10, padding: '5px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', background: C.panel, color: C.text, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
              title="Auto-arrange the graph">
              <Icon name="account_tree" size={12} /> Tidy
            </button>
            <button onClick={() => setPaletteOpen(true)}
              style={{ fontSize: 10, padding: '5px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', background: C.panel, color: C.muted, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 5 }}
              title="Add a node (Tab)">
              <Icon name="add" size={12} /> Add <span style={{ marginLeft: 'auto', fontSize: 9, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 3, padding: '0 4px' }}>Tab</span>
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {paletteOpen && <NodePalette onPick={addAtCenter} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

// ── Node command palette — Tab opens; type to filter by name, or "!" to filter by
// category (e.g. "!val", "!source"). ↑↓ to move, Enter/click to add, Esc to close.
function filterNodes(query) {
  const defs = NODE_TYPES.map(t => NODE_DEFS[t])
  const q = query.trim().toLowerCase()
  if (!q) return defs
  if (q.startsWith('!')) {
    const cq = q.slice(1).trim()
    return defs.filter(d => !cq || d.category.toLowerCase().includes(cq))
  }
  return defs.filter(d => d.label.toLowerCase().includes(q) || d.type.includes(q) || d.category.toLowerCase().includes(q))
}

function NodePalette({ onPick, onClose }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const results = useMemo(() => filterNodes(q), [q])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) onPick(results[sel].type) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Tab') { e.preventDefault(); setSel(s => (s + (e.shiftKey ? -1 : 1) + results.length) % Math.max(1, results.length)) }
  }

  return (
    <div onMouseDown={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(6,6,8,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 380, maxWidth: '90%', background: '#15151a', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 16px 50px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
          <Icon name="search" size={16} color={C.muted} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Add node…  (! to filter by category)"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 14, fontFamily: 'inherit' }} />
          <span style={{ fontSize: 9, color: C.muted }}>↑↓ · Enter · Esc</span>
        </div>
        <div ref={listRef} style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }}>
          {results.length === 0 && <div style={{ padding: 14, fontSize: 12, color: C.muted, textAlign: 'center' }}>No nodes match “{q}”.</div>}
          {results.map((d, i) => (
            <div key={d.type} data-sel={i === sel ? '1' : '0'} onMouseEnter={() => setSel(i)} onClick={() => onPick(d.type)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', background: i === sel ? 'rgba(255,120,73,0.12)' : 'transparent', border: `1px solid ${i === sel ? '#ff7849' : 'transparent'}` }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: CATEGORY_COLOR[d.category], flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: i === sel ? C.text : '#ccc' }}>{d.label}</span>
              <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{d.category}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
