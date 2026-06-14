// ── Motion Maker — exporters ───────────────────────────────────────────────────
//
// Every exporter consumes the same deterministic frame evaluation, so output always
// matches the preview. GIF + PNG-sequence rasterize each frame to an offscreen
// canvas; video records a canvas via MediaRecorder (MP4 when the platform supports
// it, else WebM — true ffmpeg MP4 is Phase 2). Lottie is Phase 3.

import { evaluateScene } from './engine.js'
import { rasterizeScene } from './render.jsx'
import { encodeGif, framesToZip } from '../../lib/gif.js'

function frameList(doc) {
  const out = []
  for (let f = doc.frameStart; f <= doc.frameEnd; f++) out.push(f)
  return out
}

// Rasterize the whole range to an array of canvases.
async function renderFrames(doc, bg, onProgress) {
  const frames = frameList(doc)
  const canvases = []
  for (let i = 0; i < frames.length; i++) {
    const cv = document.createElement('canvas')
    cv.width = doc.canvas.w; cv.height = doc.canvas.h
    const ctx = cv.getContext('2d')
    await rasterizeScene(evaluateScene(doc, frames[i]), ctx, bg)
    canvases.push(cv)
    onProgress?.((i + 1) / frames.length)
  }
  return canvases
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function exportGif(doc, { bg = '#ffffff' } = {}, onProgress) {
  const canvases = await renderFrames(doc, bg, p => onProgress?.(p * 0.7))
  const delay = Math.round(1000 / (doc.fps || 30))
  const blob = await encodeGif(canvases, canvases.map(() => delay))
  onProgress?.(1)
  return blob
}

export async function exportFramesZip(doc, onProgress) {
  // PNG sequence keeps alpha (transparent matte).
  const canvases = await renderFrames(doc, 'transparent', p => onProgress?.(p * 0.8))
  const blob = await framesToZip(canvases, 'motion')
  onProgress?.(1)
  return blob
}

function pickVideoMime() {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return (typeof MediaRecorder !== 'undefined' && types.find(t => MediaRecorder.isTypeSupported(t))) || null
}

export function videoExtAvailable() {
  const mime = pickVideoMime()
  return mime ? (mime.includes('mp4') ? 'mp4' : 'webm') : null
}

// Record the range off a canvas in realtime. Returns { blob, ext }.
export async function exportVideo(doc, { bg = '#000000' } = {}, onProgress) {
  const mime = pickVideoMime()
  if (!mime) throw new Error('MediaRecorder not available')
  const ext = mime.includes('mp4') ? 'mp4' : 'webm'
  const cv = document.createElement('canvas')
  cv.width = doc.canvas.w; cv.height = doc.canvas.h
  const ctx = cv.getContext('2d')
  const fps = Math.max(1, Math.round(doc.fps || 30))
  const stream = cv.captureStream(fps)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  const stopped = new Promise(res => { rec.onstop = res })
  rec.start()
  const frames = frameList(doc)
  for (let i = 0; i < frames.length; i++) {
    await rasterizeScene(evaluateScene(doc, frames[i]), ctx, bg)
    onProgress?.((i + 1) / frames.length)
    await new Promise(r => setTimeout(r, 1000 / fps))
  }
  await new Promise(r => setTimeout(r, 140))
  rec.stop()
  await stopped
  return { blob: new Blob(chunks, { type: mime }), ext }
}
