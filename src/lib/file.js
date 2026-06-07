// ── File utilities ────────────────────────────────────────────────────────────
import { parseSvgText } from './svg.js'

export function readAsText(file) {
  return new Promise(r => {
    const fr = new FileReader()
    fr.onload = e => r(e.target.result)
    fr.readAsText(file)
  })
}

export function readAsDataUrl(file) {
  return new Promise(r => {
    const fr = new FileReader()
    fr.onload = e => r(e.target.result)
    fr.readAsDataURL(file)
  })
}

export async function processFile(file) {
  if (!file) return null
  if (file.type === 'image/svg+xml' || file.name?.endsWith('.svg')) {
    const text = await readAsText(file)
    const parsed = parseSvgText(text)
    if (!parsed) return null
    return { name: file.name || 'pasted.svg', type: 'svg', ...parsed }
  }
  const dataUrl = await readAsDataUrl(file)
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({
      name: file.name || 'image.png',
      type: 'raster',
      dataUrl,
      vw: img.width,
      vh: img.height,
      aspect: img.width / img.height,
    })
    img.src = dataUrl
  })
}
