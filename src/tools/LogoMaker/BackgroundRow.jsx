import { C } from './ui.jsx'
import { wcagContrast, wcagRating } from '../../lib/color.js'

// ── BackgroundRow ─────────────────────────────────────────────────────────────
// Props: svgDataUrl, logoColor, brandColor
// 6 cells: white, light, mid, dark, black, brand
export function BackgroundRow({ svgDataUrl, logoColor, brandColor }) {
  const cells = [
    { label: 'White',  bg: '#ffffff' },
    { label: 'Light',  bg: '#e8e8e8' },
    { label: 'Mid',    bg: '#808080' },
    { label: 'Dark',   bg: '#303030' },
    { label: 'Black',  bg: '#000000' },
    { label: 'Brand',  bg: brandColor || '#3366ff' },
  ]

  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      display: 'flex',
      background: C.bg,
    }}>
      {cells.map(cell => {
        const ratio = logoColor ? wcagContrast(logoColor, cell.bg) : null
        const rating = ratio ? wcagRating(ratio) : null
        const badgeColor = rating === 'AAA' || rating === 'AA' ? '#4caf50'
          : rating === 'A' ? '#ff9800'
          : '#f44336'

        return (
          <div key={cell.label} style={{
            flex: 1,
            height: 72,
            background: cell.bg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            position: 'relative',
          }}>
            {svgDataUrl && (
              <img
                src={svgDataUrl}
                style={{ height: 40, objectFit: 'contain', maxWidth: '90%' }}
              />
            )}
            {ratio != null && (
              <div style={{
                position: 'absolute',
                bottom: 3,
                left: 0,
                right: 0,
                textAlign: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: badgeColor,
                letterSpacing: 0.3,
                textShadow: `0 0 4px ${cell.bg}`,
              }}>
                {ratio.toFixed(1)} {rating}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
