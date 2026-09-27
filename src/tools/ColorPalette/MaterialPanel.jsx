// ── Material-based colour suggestions panel ───────────────────────────────────
// NOTE: no emoji in the UI — use <Icon /> (Google Material icons) only.
//
// Pick the material you're rendering and get physically-plausible shadow /
// highlight colours that respect how that surface actually reads under light —
// not just a darker/lighter base. Grounded stays true to the material;
// Expressive pushes it for stylised work. A priority "hero" colour weights the
// suggestions so they support it rather than compete.

import { useState, useMemo } from 'react'
import { usePalette, addSwatch } from './store.js'
import { MATERIALS, MATERIAL_BY_ID, suggestMaterialColors } from '../../lib/materials.js'
import { ModeChip, MiniBtn, ACCENT, T } from './panelUi.jsx'

export default function MaterialPanel() {
  const { swatches, active } = usePalette()
  const sw = swatches.find(s => s.id === active)
  const [materialId, setMaterialId] = useState('apple')
  const [mode, setMode] = useState('grounded')
  const [heroId, setHeroId] = useState(null)
  const [intensity, setIntensity] = useState(1)

  const heroHex = heroId ? swatches.find(s => s.id === heroId)?.hex ?? null : null
  const stops = useMemo(
    () => (sw ? suggestMaterialColors(sw.hex, MATERIAL_BY_ID[materialId] ?? MATERIALS[0], mode, heroHex, intensity) : []),
    [sw?.hex, materialId, mode, heroHex, intensity]
  )

  if (!sw) return <div style={{ color: T.faint, fontSize: T.body }}>Select a swatch to use as the base colour.</div>
  const mat = MATERIAL_BY_ID[materialId] ?? MATERIALS[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>

      {/* Base colour */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 26, height: 26, borderRadius: 6, background: sw.hex, border: `1px solid ${T.line}`, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: T.body, color: T.textDim }}>{sw.name || 'Base colour'}</div>
          <div className="cp-num" style={{ fontSize: T.label, color: T.faint }}>{sw.hex}</div>
        </div>
      </div>

      {/* Material picker */}
      <div>
        <Label>Material</Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {MATERIALS.map(m => (
            <ModeChip key={m.id} active={materialId === m.id} onClick={() => setMaterialId(m.id)} title={m.desc} grow={false}>
              {m.name}
            </ModeChip>
          ))}
        </div>
        <div style={{ fontSize: T.label, color: T.faint, marginTop: 6, lineHeight: 1.5 }}>{mat.desc}</div>
      </div>

      {/* Mode */}
      <div>
        <Label>Mode</Label>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            ['grounded', 'Grounded', 'Physically plausible — true to the material'],
            ['expressive', 'Expressive', 'Pushed for stylised, painterly work — still harmonious'],
            ['extreme', 'Extreme', 'Graphic complementary split — shadows rotate toward the base’s opposite hue, highlights the other way. Posterised values, can rival the hero. Still in-gamut.'],
          ].map(([id, label, desc]) => (
            <ModeChip key={id} active={mode === id} onClick={() => setMode(id)} title={desc}>{label}</ModeChip>
          ))}
        </div>

        {/* Extreme push slider */}
        {mode === 'extreme' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: T.label, color: T.muted, whiteSpace: 'nowrap' }}>Push</span>
            <input type="range" min={0.2} max={1.6} step={0.05} value={intensity}
              onChange={e => setIntensity(+e.target.value)}
              style={{ flex: 1, accentColor: ACCENT }} />
            <span className="cp-num" style={{ fontSize: T.label, color: T.accentText, width: 38, textAlign: 'right' }}>
              {Math.round(intensity * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Priority / hero colour */}
      <div>
        <Label>Priority colour <span style={{ color: T.faint, textTransform: 'none', letterSpacing: 0 }}>— suggestions defer so it pops</span></Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          <ModeChip active={heroId === null} onClick={() => setHeroId(null)} grow={false}>None</ModeChip>
          {swatches.map(s => {
            const on = heroId === s.id
            return (
              <button key={s.id} onClick={() => setHeroId(on ? null : s.id)} title={on ? 'Clear priority' : `Make ${s.name || s.hex} the hero`}
                style={{
                  width: 22, height: 22, borderRadius: 5, background: s.hex, cursor: 'pointer',
                  border: on ? `2px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.12)',
                  boxShadow: on ? `0 0 0 1px ${ACCENT}, 0 0 6px ${ACCENT}80` : 'none',
                  padding: 0,
                }} />
            )
          })}
        </div>
      </div>

      {/* Suggested ramp */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Label style={{ margin: 0 }}>Suggestions</Label>
          <span style={{ fontSize: T.micro, color: T.faint }}>click a swatch to add</span>
          <div style={{ flex: 1 }} />
          <MiniBtn variant="primary" onClick={() => stops.filter(s => s.label !== 'Base').forEach(s => addSwatch(s.hex, 'freeform', { name: s.label, material: mat.name }))}>
            Add shadows + highlights
          </MiniBtn>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {stops.map(s => (
            <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
              <button onClick={() => addSwatch(s.hex, 'freeform', { name: s.label, material: mat.name })} title={`Add ${s.hex}`}
                style={{
                  width: '100%', aspectRatio: '1 / 1.25', borderRadius: 6, background: s.hex,
                  border: s.label === 'Base' ? `2px solid ${ACCENT}` : `1px solid ${T.line}`,
                  cursor: 'pointer', padding: 0,
                }} />
              <div style={{ fontSize: T.micro, color: s.label === 'Base' ? T.accentText : T.muted, textAlign: 'center' }}>{s.label}</div>
              <div className="cp-num" style={{ fontSize: T.micro, color: T.faint }}>{s.hex}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Label({ children, style }) {
  return (
    <div style={{ fontSize: T.micro, color: T.faint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, ...style }}>
      {children}
    </div>
  )
}
