// ── GIF / image-sequence helpers ────────────────────────────────────────────────
//
//   decodeGif(file)      → { frames:[{canvas, delay}], width, height }   (native ImageDecoder)
//   encodeGif(canvases, delaysMs) → Blob (animated GIF, looped)          (gifenc)
//   framesToZip(canvases, base)   → Blob (ZIP of PNG frames)             (jszip)

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import JSZip from 'jszip'

export function gifDecodeSupported() {
  return typeof window !== 'undefined' && 'ImageDecoder' in window
}

// Decode an animated GIF into per-frame canvases. Falls back to a single frame
// for static images. Frame delays are returned in milliseconds.
export async function decodeGif(file) {
  const buf = await file.arrayBuffer()
  const dec = new window.ImageDecoder({ data: buf, type: 'image/gif' })
  await dec.tracks.ready
  const track = dec.tracks.selectedTrack
  const count = track ? track.frameCount : 1
  const frames = []
  // GIF frames can be partial (disposal); composite onto a persistent canvas.
  let W = 0, H = 0, comp = null, cctx = null
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i })
    if (!comp) {
      W = image.displayWidth; H = image.displayHeight
      comp = document.createElement('canvas'); comp.width = W; comp.height = H
      cctx = comp.getContext('2d')
    }
    cctx.drawImage(image, 0, 0)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    cv.getContext('2d').drawImage(comp, 0, 0)
    frames.push({ canvas: cv, delay: image.duration ? Math.max(20, Math.round(image.duration / 1000)) : 100 })
    image.close()
  }
  return { frames, width: W, height: H }
}

// Load an arbitrary image file into a single-frame canvas (for multi-file
// sequences where each file is one frame).
export function fileToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight
      cv.getContext('2d').drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      resolve(cv)
    }
    img.onerror = e => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

// Encode result canvases into an animated, looping GIF. All frames are resized to
// the first frame's dimensions. delaysMs is a per-frame array (milliseconds).
export async function encodeGif(canvases, delaysMs) {
  if (!canvases.length) return null
  const W = canvases[0].width, H = canvases[0].height
  const enc = GIFEncoder()
  for (let i = 0; i < canvases.length; i++) {
    let cv = canvases[i]
    if (cv.width !== W || cv.height !== H) {
      const t = document.createElement('canvas'); t.width = W; t.height = H
      t.getContext('2d').drawImage(cv, 0, 0, W, H); cv = t
    }
    const { data } = cv.getContext('2d').getImageData(0, 0, W, H)
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    enc.writeFrame(index, W, H, { palette, delay: Math.max(20, delaysMs[i] || 100) })
    // Yield occasionally so the UI can update on long sequences.
    if (i % 8 === 7) await new Promise(r => setTimeout(r))
  }
  enc.finish()
  return new Blob([enc.bytes()], { type: 'image/gif' })
}

// Bundle result canvases as a ZIP of numbered PNG frames.
export async function framesToZip(canvases, base) {
  const zip = new JSZip()
  const pngs = await Promise.all(canvases.map(cv => new Promise(res => cv.toBlob(res, 'image/png'))))
  pngs.forEach((blob, i) => zip.file(`${base}-${String(i + 1).padStart(3, '0')}.png`, blob))
  return zip.generateAsync({ type: 'blob' })
}
