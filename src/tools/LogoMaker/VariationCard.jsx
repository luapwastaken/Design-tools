import { useState } from 'react'
import { C } from './ui.jsx'
import { LockupSvg } from './LockupSvg.jsx'

// ── VariationCard ─────────────────────────────────────────────────────────────
export function VariationCard({ variation, applicable, lockupProps, bgColor, active, onClick }) {
  const [hov, setHov] = useState(false)
  const isPreview = variation.previewOnly
  const clickable = !!onClick

  return (
    <div
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: bgColor, position: 'relative', overflow: 'hidden',
        cursor: clickable ? 'pointer' : 'default',
        outline: active ? `2px solid ${C.accent}` : hov && clickable ? `1px solid ${C.accent}55` : 'none',
        outlineOffset: -2, transition: 'outline 0.12s',
      }}
    >
      {applicable ? (
        <LockupSvg {...lockupProps} style={{ width: '100%', height: '100%', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 20, opacity: 0.12, color: C.muted }}>◫</div>
          <div style={{ fontSize: 11, color: C.dim }}>Load {lockupProps.layout === 'i' ? 'icon' : lockupProps.layout === 'w' ? 'wordmark' : 'both files'}</div>
        </div>
      )}

      {/* Label */}
      <div style={{
        position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center',
        fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
        color: hov && clickable ? C.accent : C.muted,
        opacity: hov ? 1 : 0.6, transition: 'color 0.12s, opacity 0.12s',
        pointerEvents: 'none',
      }}>
        {variation.label}
      </div>

      {/* Hover hint */}
      {hov && clickable && applicable && (
        <div style={{
          position: 'absolute', top: 8, right: 8, fontSize: 10, color: C.accent,
          background: `${C.bg}cc`, padding: '2px 6px', borderRadius: 3, pointerEvents: 'none',
        }}>
          {isPreview ? 'Preview →' : 'Refine →'}
        </div>
      )}
    </div>
  )
}
