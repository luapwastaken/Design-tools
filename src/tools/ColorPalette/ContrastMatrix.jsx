import { contrast, wcagRating } from '../../lib/color.js'
import { usePalette } from './store.js'
import { T, Hint, Badge } from './panelUi.jsx'

const RATING_COLOR = { AAA: T.ok, AA: '#84cc16', A: T.warn, fail: T.bad }

// ── Contrast matrix ───────────────────────────────────────────────────────────
//
// Both axes used to be anonymous 16px colour chips, so the only way to learn
// which pair a cell described was to hover it and read a tooltip — with more
// than three or four swatches the grid told you nothing at a glance. Rows are
// labelled outright now, and columns carry their names vertically, which is what
// makes the diagonal readable as "this colour against that one".

export default function ContrastMatrix() {
  const { swatches } = usePalette()

  if (swatches.length < 2) {
    return <Hint>Add at least two swatches to compare contrast ratios.</Hint>
  }

  const label = s => s.name || s.hex

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: T.micro }}>
          <thead>
            <tr>
              <th />
              {swatches.map(s => (
                <th key={s.id} scope="col" style={{ verticalAlign: 'bottom', padding: '0 0 4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                      fontSize: T.micro, color: T.muted, fontWeight: 500,
                      maxHeight: 92, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', textAlign: 'right',
                    }}>{label(s)}</span>
                    <span style={{
                      width: 20, height: 20, borderRadius: 4,
                      background: s.hex, border: `1px solid ${T.line}`,
                    }} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {swatches.map(row => (
              <tr key={row.id}>
                <th scope="row" style={{ padding: '0 8px 0 0', textAlign: 'right', fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <span style={{
                      fontSize: T.micro, color: T.muted,
                      maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{label(row)}</span>
                    <span style={{
                      width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                      background: row.hex, border: `1px solid ${T.line}`,
                    }} />
                  </div>
                </th>
                {swatches.map(col => {
                  if (row.id === col.id) {
                    return (
                      <td key={col.id} style={{
                        textAlign: 'center', color: T.faint,
                        background: T.panel, borderRadius: 4,
                      }}>—</td>
                    )
                  }
                  const ratio = contrast(row.hex, col.hex)
                  const rating = wcagRating(ratio)
                  return (
                    <td key={col.id} style={{ padding: 0 }}
                      title={`${label(row)} on ${label(col)} — ${ratio.toFixed(2)}:1 (${rating})`}>
                      <div className="cp-num" style={{
                        fontSize: T.label, fontWeight: 700,
                        color: RATING_COLOR[rating],
                        background: rating === 'fail' ? 'rgba(248,113,113,0.1)' : T.raised,
                        borderRadius: 4, padding: '5px 4px 4px',
                        minWidth: 44, textAlign: 'center',
                      }}>
                        {ratio.toFixed(1)}
                        <div style={{ fontSize: T.micro, fontWeight: 500, opacity: 0.85 }}>{rating}</div>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone="pass">AAA — 7:1</Badge>
        <Badge tone="pass">AA — 4.5:1</Badge>
        <Badge tone="partial">A — 3:1, large text only</Badge>
        <Badge tone="fail">fail</Badge>
      </div>
      <Hint>Read a row as the text colour and a column as what it sits on.</Hint>
    </div>
  )
}
