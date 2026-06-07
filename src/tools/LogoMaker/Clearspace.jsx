import { useEffect, useRef } from 'react'
import { C, Section, SliderRow, Toggle } from './ui.jsx'

// ── ClearspaceSection ─────────────────────────────────────────────────────────
export function ClearspaceSection({
  showClearspace, onShowClearspace,
  clearspaceN, onClearspaceN,
  showMinSizes, onShowMinSizes,
}) {
  return (
    <Section title="Clearspace">
      <Toggle label="Clearspace overlay" value={showClearspace} onChange={onShowClearspace} />
      {showClearspace && (
        <SliderRow
          label="N ×"
          min={0.1} max={3} step={0.1}
          value={clearspaceN} onChange={onClearspaceN}
          toFixed={1}
        />
      )}
      <Toggle label="Min-size strip" value={showMinSizes} onChange={onShowMinSizes} />
    </Section>
  )
}

// ── MinSizeStrip ──────────────────────────────────────────────────────────────
export function MinSizeStrip({ svgString, bgColor }) {
  const SIZES = [16, 24, 32, 48, 96, 128]

  return (
    <div style={{
      background: C.bg,
      borderTop: `1px solid ${C.border}`,
      padding: '8px 16px',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-end',
      flexWrap: 'wrap',
    }}>
      {SIZES.map(size => (
        <MinSizeCell key={size} size={size} svgString={svgString} bgColor={bgColor} />
      ))}
    </div>
  )
}

function MinSizeCell({ size, svgString, bgColor }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !svgString) return
    const ctx = canvas.getContext('2d')
    canvas.width = size
    canvas.height = size

    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = bgColor || '#000000'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
  }, [size, svgString, bgColor])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <canvas ref={canvasRef} width={size} height={size} style={{ display: 'block' }} />
      <span style={{ fontSize: 9, color: C.muted, letterSpacing: 0.5 }}>{size}px</span>
    </div>
  )
}
