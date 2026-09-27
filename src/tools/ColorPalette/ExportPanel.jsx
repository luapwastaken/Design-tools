import { useState, useMemo } from 'react'
import JSZip from 'jszip'
import { toRgb255 } from '../../lib/color.js'
import { hexToCmyk } from '../../lib/cmyk.js'
import { usePalette } from './store.js'
import { markSaved } from '../../lib/unsavedChanges.js'
import { EditableNumber } from '../../components/NumberField.jsx'
import { T, Section, Btn, MiniBtn, FieldLabel, Hint } from './panelUi.jsx'

// ── Text format builders ──────────────────────────────────────────────────────

function toCssVars(swatches) {
  return swatches.map(s => {
    const { l, c, h } = s.oklch
    const key = s.name ? s.name.toLowerCase().replace(/\s+/g, '-') : s.id
    return `  --color-${key}: oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)});\n  --color-${key}-hex: ${s.hex};`
  }).join('\n')
}

function toTailwind(swatches) {
  const obj = {}
  for (const s of swatches) obj[s.name ? s.name.toLowerCase().replace(/\s+/g, '-') : s.id] = s.hex
  return `module.exports = {\n  theme: {\n    extend: {\n      colors: ${JSON.stringify(obj, null, 8).replace(/^/gm, '      ').trim()}\n    }\n  }\n}`
}

function toGpl(swatches, name = 'Palette') {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#']
  for (const s of swatches) {
    const [r, g, b] = toRgb255(s.hex)
    lines.push(`${r}\t${g}\t${b}\t${s.name || s.hex}`)
  }
  return lines.join('\n')
}

function toJson(swatches) {
  return JSON.stringify(swatches.map(s => ({
    name: s.name, role: s.role, material: s.material || undefined, hex: s.hex, oklch: s.oklch,
    rgb: (() => { const [r,g,b] = toRgb255(s.hex); return {r,g,b} })(),
    cmyk: hexToCmyk(s.hex), locked: s.locked, spotColor: s.spotColor,
  })), null, 2)
}

// Neatly formatted, human-readable plain text sheet.
function toTxt(swatches, name = 'Palette') {
  const lines = [name.toUpperCase(), '='.repeat(48),
    `${swatches.length} color${swatches.length === 1 ? '' : 's'} · exported ${new Date().toLocaleDateString()}`, '']
  swatches.forEach((s, i) => {
    const [r, g, b] = toRgb255(s.hex)
    const { c: cy, m, y, k } = hexToCmyk(s.hex)
    const { l, c, h } = s.oklch
    lines.push(`${String(i + 1).padStart(2, '0')}. ${s.name || '(unnamed)'}`)
    if (s.material) lines.push(`    Material : ${s.material}`)
    if (s.role && s.role !== 'freeform') lines.push(`    Role     : ${s.role}`)
    lines.push(`    HEX      : ${s.hex.toUpperCase()}`)
    lines.push(`    RGB      : ${r}, ${g}, ${b}`)
    lines.push(`    CMYK     : ${cy}, ${m}, ${y}, ${k}`)
    lines.push(`    OKLCH    : ${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)}`)
    if (s.spotColor) lines.push('    Spot color')
    lines.push('')
  })
  return lines.join('\n')
}

// ── Binary format builders ────────────────────────────────────────────────────

function buildAse(swatches) {
  function writeStr16(s) {
    const chars = [...s].map(c => c.charCodeAt(0))
    const buf = new Uint8Array((chars.length + 1) * 2)
    const view = new DataView(buf.buffer)
    for (let i = 0; i < chars.length; i++) view.setUint16(i * 2, chars[i])
    view.setUint16(chars.length * 2, 0)
    return buf
  }
  const blocks = []
  for (const sw of swatches) {
    const nameBytes = writeStr16(sw.name || sw.hex)
    const [r, g, b] = toRgb255(sw.hex).map(v => v / 255)
    const blockData = new ArrayBuffer(2 + nameBytes.length + 4 + 3*4 + 2)
    const dv = new DataView(blockData)
    let off = 0
    dv.setUint16(off, nameBytes.length / 2); off += 2
    new Uint8Array(blockData, off, nameBytes.length).set(nameBytes); off += nameBytes.length
    dv.setUint32(off, 0x52474220); off += 4
    dv.setFloat32(off, r); off += 4
    dv.setFloat32(off, g); off += 4
    dv.setFloat32(off, b); off += 4
    dv.setUint16(off, sw.spotColor ? 1 : 2)
    blocks.push({ type: 0x0001, data: blockData })
  }
  const headerSize = 12
  let total = headerSize
  for (const b of blocks) total += 2 + 4 + b.data.byteLength
  const out = new ArrayBuffer(total)
  const ov = new DataView(out)
  ;[0x41,0x53,0x45,0x46].forEach((b, i) => ov.setUint8(i, b))
  ov.setUint16(4, 1); ov.setUint16(6, 0)
  ov.setUint32(8, blocks.length)
  let pos = headerSize
  for (const b of blocks) {
    ov.setUint16(pos, b.type); pos += 2
    ov.setUint32(pos, b.data.byteLength); pos += 4
    new Uint8Array(out, pos, b.data.byteLength).set(new Uint8Array(b.data))
    pos += b.data.byteLength
  }
  return out
}

// ACO v1 — Photoshop / Clip Studio Paint
function buildAco(swatches) {
  const n = swatches.length
  const buf = new ArrayBuffer(4 + n * 10)
  const dv = new DataView(buf)
  dv.setUint16(0, 1)   // version
  dv.setUint16(2, n)   // count
  swatches.forEach((sw, i) => {
    const [r, g, b] = toRgb255(sw.hex)
    const off = 4 + i * 10
    dv.setUint16(off, 0)            // RGB color space
    dv.setUint16(off + 2, r * 257)  // 0-255 → 0-65535
    dv.setUint16(off + 4, g * 257)
    dv.setUint16(off + 6, b * 257)
    dv.setUint16(off + 8, 0)        // unused
  })
  return buf
}

// Procreate .swatches (ZIP containing JSON with HSB values)
async function buildProcreateSwatches(swatches, paletteName = 'Palette') {
  function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    const brightness = max, saturation = max === 0 ? 0 : d / max
    let hue = 0
    if (d !== 0) {
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (max === g) hue = ((b - r) / d + 2) / 6
      else hue = ((r - g) / d + 4) / 6
    }
    return { hue, saturation, brightness }
  }
  const json = JSON.stringify({
    name: paletteName,
    swatches: swatches.map(sw => {
      const [r, g, b] = toRgb255(sw.hex)
      const { hue, saturation, brightness } = rgbToHsb(r, g, b)
      return { hue, saturation, brightness, alpha: 1.0, colorSpace: 0 }
    }),
  })
  const zip = new JSZip()
  zip.file(`${paletteName}.json`, json)
  return zip.generateAsync({ type: 'arraybuffer' })
}

// ── SVG color sheet ───────────────────────────────────────────────────────────

function escapeXml(s) {
  return String(s).replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))
}

function buildSvgSheet(swatches, cols = 4) {
  const SW = 120, SH = 80, PAD = 16, LABEL_H = 36
  const rows = Math.ceil(swatches.length / cols)
  const W = cols * (SW + PAD) + PAD
  const H = rows * (SH + LABEL_H + PAD) + PAD
  const chips = swatches.map((s, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const x = PAD + col * (SW + PAD), y = PAD + row * (SH + LABEL_H + PAD)
    const { l, c, h } = s.oklch
    const label = [s.name, s.material].filter(Boolean).join(' · ')
    return `<rect x="${x}" y="${y}" width="${SW}" height="${SH}" fill="${s.hex}" rx="8"/>
    <text x="${x+6}" y="${y+SH+14}" font-size="10" fill="#ccc">${escapeXml(label)}</text>
    <text x="${x+6}" y="${y+SH+26}" font-size="9" fill="#666" font-family="monospace">${s.hex}</text>
    <text x="${x+6}" y="${y+SH+36}" font-size="9" fill="#555" font-family="monospace">oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h.toFixed(0)})</text>`
  }).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#111"/>${chips}</svg>`
}

// ── Download helpers ──────────────────────────────────────────────────────────

function downloadText(text, filename, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  markSaved('color-palette')
}

function downloadBinary(buffer, filename) {
  const url = URL.createObjectURL(new Blob([buffer]))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  markSaved('color-palette')
}

// Rasterise the SVG sheet to a PNG (scaled up for a crisp result).
function downloadSvgAsPng(svgString, filename, scale = 2) {
  const m = svgString.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/)
  const w = m ? Math.round(+m[1]) : 800, h = m ? Math.round(+m[2]) : 600
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: filename })
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      markSaved('color-palette')
    }, 'image/png')
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
}

// ── Export panel UI ───────────────────────────────────────────────────────────

export default function ExportPanel() {
  const { swatches } = usePalette()
  const [cols, setCols] = useState(4)
  const [showPreview, setShowPreview] = useState(true)

  const svgString = useMemo(() => buildSvgSheet(swatches, cols), [swatches, cols])
  const svgDataUrl = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`,
    [svgString]
  )

  if (!swatches.length) {
    return <Hint style={{ padding: 12 }}>No swatches to export.</Hint>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Color sheet with inline preview */}
      <Section label="Color sheet">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <FieldLabel>Columns</FieldLabel>
          <input type="range" min={2} max={8} value={cols} onChange={e => setCols(+e.target.value)}
            style={{ flex: 1, accentColor: T.accent }} />
          <EditableNumber value={cols} onChange={setCols} min={2} max={8} step={1} accent={T.accent} width={28} color={T.text} />
          <MiniBtn variant="ghost" onClick={() => setShowPreview(v => !v)}>
            {showPreview ? 'Hide' : 'Preview'}
          </MiniBtn>
        </div>

        {/* Inline SVG preview */}
        {showPreview && (
          <div style={{ marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.line}` }}>
            <img src={svgDataUrl} alt="Palette preview"
              style={{ width: '100%', display: 'block', imageRendering: 'pixelated' }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <Btn variant="primary" onClick={() => downloadText(svgString, 'palette.svg', 'image/svg+xml')}>Download SVG</Btn>
          <Btn variant="primary" onClick={() => downloadSvgAsPng(svgString, 'palette.png')}>Download PNG</Btn>
        </div>
      </Section>

      {/* Data formats */}
      <Section label="Code + data">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Btn variant="primary" onClick={() => downloadText(`:root {\n${toCssVars(swatches)}\n}`, 'palette.css', 'text/css')}>CSS variables</Btn>
          <Btn variant="primary" onClick={() => downloadText(toTailwind(swatches), 'tailwind.config.js', 'text/javascript')}>Tailwind config</Btn>
          <Btn variant="primary" onClick={() => downloadText(toTxt(swatches), 'palette.txt', 'text/plain')}>Text (.txt)</Btn>
          <Btn variant="primary" onClick={() => downloadText(toJson(swatches), 'palette.json', 'application/json')}>JSON</Btn>
          <Btn variant="primary" onClick={() => downloadText(toGpl(swatches), 'palette.gpl', 'text/plain')}>GPL (GIMP / Krita)</Btn>
        </div>
      </Section>

      {/* App palette formats */}
      <Section label="App palette formats">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Btn variant="primary" onClick={() => downloadBinary(buildAse(swatches), 'palette.ase')} title="Adobe Illustrator, Photoshop, InDesign, Clip Studio Paint">
            ASE (Adobe / CSP)
          </Btn>
          <Btn variant="primary" onClick={() => downloadBinary(buildAco(swatches), 'palette.aco')} title="Photoshop ACO, Clip Studio Paint">
            ACO (Photoshop / CSP)
          </Btn>
          <Btn variant="primary" onClick={async () => {
            const buf = await buildProcreateSwatches(swatches)
            downloadBinary(buf, 'palette.swatches')
          }} title="Procreate for iPad">
            Procreate (.swatches)
          </Btn>
        </div>
        <Hint style={{ marginTop: 8 }}>
          Krita: use GPL above. CSP: import ASE or ACO via Edit → Color Sets.
          Procreate: share the .swatches file to your iPad and open with Procreate.
        </Hint>
      </Section>

      <Section label="Note">
        <Hint>
          Pantone libraries are excluded due to licensing.
          Import your own .ase from Pantone Color Manager for Pantone matching.
        </Hint>
      </Section>
    </div>
  )
}
