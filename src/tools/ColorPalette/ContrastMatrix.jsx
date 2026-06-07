import { contrast, wcagRating } from '../../lib/color.js'
import { usePalette } from './store.js'

const RATING_COLOR = {
  AAA: '#22c55e', AA: '#84cc16', A: '#f59e0b', fail: '#ef4444',
}

export default function ContrastMatrix() {
  const { swatches } = usePalette()

  if (swatches.length < 2) {
    return <div style={{ color: '#666', fontSize: 12, padding: 12 }}>Add at least 2 swatches to see contrast ratios.</div>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 24 }} />
            {swatches.map(s => (
              <th key={s.id} style={{ padding: 3 }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, background: s.hex, border: '1px solid #333', margin: '0 auto' }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {swatches.map(row => (
            <tr key={row.id}>
              <td style={{ padding: 3 }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, background: row.hex, border: '1px solid #333' }} />
              </td>
              {swatches.map(col => {
                if (row.id === col.id) {
                  return <td key={col.id} style={{ padding: 2, textAlign: 'center', background: '#111' }}>—</td>
                }
                const ratio = contrast(row.hex, col.hex)
                const rating = wcagRating(ratio)
                return (
                  <td key={col.id} style={{ padding: 2, textAlign: 'center' }}
                    title={`${row.hex} on ${col.hex}: ${ratio.toFixed(1)}:1 (${rating})`}>
                    <div style={{
                      fontSize: 9, fontWeight: 600,
                      color: RATING_COLOR[rating],
                      background: rating === 'fail' ? '#200' : 'transparent',
                      borderRadius: 3, padding: '1px 3px',
                      minWidth: 28,
                    }}>
                      {ratio.toFixed(1)}
                      <div style={{ fontSize: 8, fontWeight: 400 }}>{rating}</div>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
