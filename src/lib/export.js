// ── Export utilities ──────────────────────────────────────────────────────────
import JSZip from 'jszip'

/**
 * Renders an SVG string to a PNG Blob at the given dimensions with a background fill.
 * Uses contain-fit so non-square SVGs are letterboxed rather than distorted.
 */
export function svgToPngBlob(svgString, w, h, bgColor) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (bgColor) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, w, h)
      }
      const nw = img.naturalWidth || w
      const nh = img.naturalHeight || h
      const scale = Math.min(w / nw, h / nh)
      const dw = nw * scale, dh = nh * scale
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
      canvas.toBlob(resolve, 'image/png')
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
  })
}

/**
 * Renders an SVG string to a base64 PNG string (no data URL prefix).
 */
export function svgToPngBase64(svgString, w, h, bgColor) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (bgColor) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, w, h)
      }
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
  })
}

/**
 * Builds a multi-resolution ICO file (PNG-in-ICO, valid since Vista).
 * @param {Array<{buffer: ArrayBuffer, size: number}>} entries
 * @returns {ArrayBuffer}
 */
export function buildIco(entries) {
  const count = entries.length
  // ICONDIR: 6 bytes
  // ICONDIRENTRYs: 16 bytes each
  // PNG data follows
  const headerSize = 6 + count * 16
  let totalSize = headerSize
  for (const e of entries) totalSize += e.buffer.byteLength

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)

  // ICONDIR header
  view.setUint16(0, 0, true)      // reserved
  view.setUint16(2, 1, true)      // type: 1 = ICO
  view.setUint16(4, count, true)  // image count

  let imageOffset = headerSize
  for (let i = 0; i < count; i++) {
    const e = entries[i]
    const sz = e.size >= 256 ? 0 : e.size  // 256 is stored as 0 per ICO spec
    const entryOffset = 6 + i * 16
    view.setUint8(entryOffset + 0, sz)      // width
    view.setUint8(entryOffset + 1, sz)      // height
    view.setUint8(entryOffset + 2, 0)       // color count (0 = not palette)
    view.setUint8(entryOffset + 3, 0)       // reserved
    view.setUint16(entryOffset + 4, 1, true)  // color planes
    view.setUint16(entryOffset + 6, 32, true) // bits per pixel
    view.setUint32(entryOffset + 8, e.buffer.byteLength, true) // size of image data
    view.setUint32(entryOffset + 12, imageOffset, true)        // offset to image data
    imageOffset += e.buffer.byteLength
  }

  // Copy PNG data
  let writeOffset = headerSize
  for (const e of entries) {
    const src = new Uint8Array(e.buffer)
    const dst = new Uint8Array(buf, writeOffset, e.buffer.byteLength)
    dst.set(src)
    writeOffset += e.buffer.byteLength
  }

  return buf
}

/**
 * Builds a favicon zip bundle from an icon SVG/data URL.
 * @param {string} iconSvgOrDataUrl
 * @param {string} bgColor
 * @returns {Promise<Blob>}
 */
export async function buildFaviconZip(iconSvgOrDataUrl, bgColor) {
  // Normalize to an SVG string we can use directly
  let svgString
  if (iconSvgOrDataUrl.startsWith('data:image/svg+xml;base64,')) {
    svgString = atob(iconSvgOrDataUrl.slice('data:image/svg+xml;base64,'.length))
  } else if (iconSvgOrDataUrl.startsWith('data:image/svg+xml;charset=utf-8,')) {
    svgString = decodeURIComponent(iconSvgOrDataUrl.slice('data:image/svg+xml;charset=utf-8,'.length))
  } else if (iconSvgOrDataUrl.startsWith('<svg') || iconSvgOrDataUrl.startsWith('<?xml')) {
    svgString = iconSvgOrDataUrl
  } else {
    // Fallback: treat as data URL and fetch
    svgString = iconSvgOrDataUrl
  }

  const sizes = [16, 32, 48, 180, 192, 512]
  const zip = new JSZip()

  // Render all sizes
  const blobs = {}
  for (const size of sizes) {
    blobs[size] = await svgToPngBlob(svgString, size, size, bgColor)
  }

  // Add individual PNGs under favicons/ subfolder
  zip.file('favicons/favicon-16x16.png', blobs[16])
  zip.file('favicons/favicon-32x32.png', blobs[32])
  zip.file('favicons/favicon-48x48.png', blobs[48])
  zip.file('favicons/apple-touch-icon.png', blobs[180])
  zip.file('favicons/android-chrome-192x192.png', blobs[192])
  zip.file('favicons/android-chrome-512x512.png', blobs[512])

  // Add icon.svg
  if (svgString.startsWith('<')) {
    zip.file('favicons/icon.svg', svgString)
  }

  // Build favicon.ico from 16, 32, 48
  const icoSizes = [16, 32, 48]
  const icoEntries = await Promise.all(icoSizes.map(async size => {
    const blob = blobs[size]
    const buffer = await blob.arrayBuffer()
    return { buffer, size }
  }))
  const icoBuffer = buildIco(icoEntries)
  zip.file('favicons/favicon.ico', icoBuffer)

  return zip.generateAsync({ type: 'blob' })
}
