import { useState, useRef, useCallback } from 'react'
import { srgbToLinear, oklchToHex } from '../../lib/color.js'
import { addSwatch } from './store.js'
import { EditableNumber } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'
import { Section, FieldLabel, AddBtn, SwatchStrip, ACCENT } from './panelUi.jsx'

// Fast sRGB(0-255) → OKLab. Clustering in OKLab keeps the extracted palette
// perceptually balanced — equal numeric distance ≈ equal visible difference —
// which is why the result feels coherent where naive RGB k-means goes muddy.
function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ]
}

function oklabToHex([L, a, b]) {
  const C = Math.hypot(a, b)
  const H = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360
  return oklchToHex(L, C, H)
}

// k-means++ style init + a handful of Lloyd iterations. Small image (≤96px),
// few iterations — runs instantly and is plenty stable for a palette of ≤8.
function kmeans(points, k, iters = 12) {
  const n = points.length
  if (n === 0) return []
  const centroids = [points[Math.floor(Math.random() * n)]]
  while (centroids.length < k) {
    const d2 = points.map(p => Math.min(...centroids.map(c =>
      (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)))
    const sum = d2.reduce((a, b) => a + b, 0) || 1
    let r = Math.random() * sum, idx = 0
    while (r > 0 && idx < n - 1) { r -= d2[idx]; idx++ }
    centroids.push(points[idx])
  }
  const assign = new Array(n).fill(0)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity
      for (let c = 0; c < centroids.length; c++) {
        const d = (points[i][0] - centroids[c][0]) ** 2 + (points[i][1] - centroids[c][1]) ** 2 + (points[i][2] - centroids[c][2]) ** 2
        if (d < bd) { bd = d; best = c }
      }
      assign[i] = best
    }
    const sums = centroids.map(() => [0, 0, 0, 0])
    for (let i = 0; i < n; i++) {
      const a = assign[i], p = points[i]
      sums[a][0] += p[0]; sums[a][1] += p[1]; sums[a][2] += p[2]; sums[a][3]++
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
    }
  }
  // weight by cluster population so dominant colours come first
  const counts = centroids.map(() => 0)
  for (const a of assign) counts[a]++
  return centroids
    .map((c, i) => ({ c, w: counts[i] }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .map(x => x.c)
}

export default function ImageExtract() {
  const [colors, setColors] = useState([])
  const [count, setCount] = useState(6)
  const [imgUrl, setImgUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const imgRef = useRef(null)

  const extract = useCallback((img, k) => {
    setBusy(true)
    const MAX = 96
    const scale = Math.min(1, MAX / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    const pts = []
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue       // skip transparent
      pts.push(rgbToOklab(data[i], data[i + 1], data[i + 2]))
    }
    const centroids = kmeans(pts, k)
    setColors(centroids.map(oklabToHex))
    setBusy(false)
  }, [])

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    const img = new Image()
    img.onload = () => { imgRef.current = img; extract(img, count) }
    img.src = url
  }

  function reExtract(k) {
    setCount(k)
    if (imgRef.current) extract(imgRef.current, k)
  }

  return (
    <Section label="Extract from Image" hint="clustered in OKLab">
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />

      <button onClick={() => fileRef.current?.click()} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        background: '#131318', border: '1px dashed #2a2a38', borderRadius: 8,
        color: '#888', padding: imgUrl ? '8px' : '22px', fontSize: 11, cursor: 'pointer',
      }}>
        <Icon name="image" size={16} color={ACCENT} />
        {imgUrl ? 'Choose a different image' : 'Drop or choose an image'}
      </button>

      {imgUrl && (
        <img src={imgUrl} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 8 }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FieldLabel>Colors</FieldLabel>
        <EditableNumber value={count} onChange={reExtract} min={2} max={10} step={1} accent={ACCENT} width={32} align="center" />
        <div style={{ flex: 1 }} />
        {busy && <span style={{ fontSize: 10, color: '#666' }}>extracting…</span>}
      </div>

      {colors.length > 0 && <SwatchStrip hexes={colors} />}

      {colors.length > 0 && (
        <AddBtn onClick={() => colors.forEach(h => addSwatch(h))}>
          + Add {colors.length} colors to palette
        </AddBtn>
      )}
    </Section>
  )
}
