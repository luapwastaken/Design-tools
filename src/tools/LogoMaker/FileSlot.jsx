import { useRef, useState } from 'react'
import { C, btn } from './ui.jsx'
import { processFile } from '../../lib/file.js'

// ── FileSlot ──────────────────────────────────────────────────────────────────
export function FileSlot({ label, file, onFile, onClear }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) { const r = await processFile(f); if (r) onFile(r) }
  }

  async function handlePick(e) {
    const f = e.target.files[0]
    if (f) { const r = await processFile(f); if (r) onFile(r) }
    e.target.value = ''
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        border: `1px dashed ${dragOver ? C.accent : C.border}`,
        borderRadius: 4, padding: 8, marginBottom: 8,
        background: dragOver ? `${C.accent}11` : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 36, height: 28, background: '#fff', borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <img src={file.dataUrl} style={{ maxWidth: 34, maxHeight: 26, objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{file.type === 'svg' ? 'SVG' : 'Raster'} · {Math.round(file.aspect * 100) / 100}:1</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <button onClick={() => inputRef.current?.click()} style={{ ...btn(), padding: '2px 6px', fontSize: 10 }}>swap</button>
            <button onClick={onClear} style={{ ...btn(), padding: '2px 6px', fontSize: 10 }}>✕</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>Drop SVG / PNG or browse</span>
          <button onClick={() => inputRef.current?.click()} style={{ ...btn(true), padding: '4px 8px', fontSize: 11 }}>Browse</button>
        </div>
      )}
      <input ref={inputRef} type="file" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
        style={{ display: 'none' }} onChange={handlePick} />
    </div>
  )
}
