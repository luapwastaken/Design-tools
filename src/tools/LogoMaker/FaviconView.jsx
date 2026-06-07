import { useState } from 'react'
import { C, btn } from './ui.jsx'
import { VARIATIONS, BOTH_LAYOUTS } from './layout.js'
import { buildFaviconZip } from '../../lib/export.js'

const PREVIEW_SIZES = [16, 32, 48, 64, 128, 256]

export function FaviconView({ iconFile, wordmarkFile, hasBoth, buildVariationSvg, bgColor, onBack }) {
  const applicableVariations = VARIATIONS.filter(v => {
    if (v.layout === 'i') return !!iconFile
    if (v.layout === 'w') return !!wordmarkFile
    return BOTH_LAYOUTS.includes(v.layout) && hasBoth
  })

  const defaultId = applicableVariations.find(v => v.id === 'icon-only')?.id
    ?? applicableVariations[0]?.id
    ?? null

  const [selectedVarId, setSelectedVarId] = useState(defaultId)
  const [exporting, setExporting] = useState(false)
  const [exportDone, setExportDone] = useState(false)

  const selectedVariation = VARIATIONS.find(v => v.id === selectedVarId)
  const selectedResult = selectedVariation ? buildVariationSvg(selectedVariation) : null
  const selectedSvg = selectedResult?.svg ?? null

  const toDataUrl = svg =>
    svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : null

  const selectedDataUrl = toDataUrl(selectedSvg)

  async function handleExport() {
    if (!selectedSvg) return
    setExporting(true)
    try {
      const blob = await buildFaviconZip(selectedSvg, bgColor)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'favicon-bundle.zip'
      a.click()
      URL.revokeObjectURL(url)
      setExportDone(true)
      setTimeout(() => setExportDone(false), 2500)
    } catch (err) {
      console.error('Favicon export failed:', err)
    }
    setExporting(false)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 38, background: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ ...btn(false), padding: '3px 8px', fontSize: 11 }}>← Back</button>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          Favicon
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: variation picker */}
        <div style={{
          width: 200, borderRight: `1px solid ${C.border}`,
          overflowY: 'auto', padding: '12px 10px', flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Source variation
          </div>
          {applicableVariations.length === 0 && (
            <div style={{ fontSize: 11, color: C.dim }}>Load files to see options</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {applicableVariations.map(v => {
              const result = buildVariationSvg(v)
              const thumbUrl = toDataUrl(result?.svg ?? null)
              const isSelected = v.id === selectedVarId
              return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVarId(v.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 7px', borderRadius: 4, cursor: 'pointer',
                    background: isSelected ? `${C.accent}20` : 'transparent',
                    outline: isSelected ? `1px solid ${C.accent}66` : `1px solid transparent`,
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, background: bgColor, flexShrink: 0,
                    borderRadius: 2, overflow: 'hidden', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {thumbUrl && (
                      <img
                        src={thumbUrl}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        draggable={false}
                      />
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: isSelected ? C.accent : C.text, lineHeight: 1.3 }}>
                    {v.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: preview + export */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
          {selectedDataUrl ? (
            <>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 20 }}>
                Preview — {selectedVariation?.label}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-end', marginBottom: 36 }}>
                {PREVIEW_SIZES.map(size => (
                  <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: size, height: size, background: bgColor,
                      overflow: 'hidden', flexShrink: 0,
                      outline: `1px solid ${C.border}`,
                    }}>
                      <img
                        src={selectedDataUrl}
                        width={size}
                        height={size}
                        style={{ display: 'block', objectFit: 'contain', width: '100%', height: '100%' }}
                        draggable={false}
                      />
                    </div>
                    <span style={{ fontSize: 9, color: C.dim }}>{size}px</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleExport}
                disabled={exporting}
                style={{ ...btn(true), padding: '8px 22px', opacity: exporting ? 0.6 : 1 }}
              >
                {exporting ? 'Generating…' : exportDone ? '✓ Done' : '⬇ Export Favicon Bundle (.zip)'}
              </button>
              <div style={{ marginTop: 8, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
                Exports to favicons/ subfolder · ICO (16/32/48), PNG (16/32/48/180/192/512), SVG
              </div>
            </>
          ) : (
            <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
              Select a variation on the left to preview
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
