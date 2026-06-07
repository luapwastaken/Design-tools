import { C, btn, Row, HexInput } from './ui.jsx'

// ── Treatment definitions ─────────────────────────────────────────────────────
export const TREATMENTS = [
  { id: 'original',    label: 'Original'   },
  { id: 'mono-black',  label: 'Mono Black' },
  { id: 'mono-white',  label: 'Mono White' },
  { id: 'single-spot', label: 'Spot Color' },
  { id: 'knockout',    label: 'Knockout'   },
  { id: 'duotone',     label: 'Duotone'    },
]

// ── TreatmentPicker ───────────────────────────────────────────────────────────
export function TreatmentPicker({
  treatment, onTreatment,
  spotColor, onSpotColor,
  duotoneDark, onDuotoneDark,
  duotoneLight, onDuotoneLight,
}) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {TREATMENTS.map(t => (
          <button
            key={t.id}
            onClick={() => onTreatment(t.id)}
            style={{ ...btn(treatment === t.id), padding: '4px 8px', fontSize: 11 }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {(treatment === 'single-spot' || treatment === 'knockout') && (
        <Row label="Spot color">
          <HexInput value={spotColor} onChange={onSpotColor} />
        </Row>
      )}
      {treatment === 'duotone' && (
        <>
          <Row label="Dark color">
            <HexInput value={duotoneDark} onChange={onDuotoneDark} />
          </Row>
          <Row label="Light color">
            <HexInput value={duotoneLight} onChange={onDuotoneLight} />
          </Row>
        </>
      )}
    </div>
  )
}
