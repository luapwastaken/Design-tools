// ── Screen colour picker ──────────────────────────────────────────────────────
//
// Opens the OS EyeDropper to grab any pixel on screen (all monitors). While the
// cursor is active, per-display desktopCapturer video streams are polled at
// ~30 fps so callers can show a live preview of the hovered colour.
//
// Returns the picked hex (e.g. "#3a7bd5") or null if the user cancelled.
// `onPreview(hex)` fires continuously while hovering; `onState(active)` toggles
// when picking starts/stops so buttons can reflect the picking state.

export function eyeDropperSupported() {
  return typeof window !== 'undefined' && 'EyeDropper' in window
}

let _busy = false
export function isPicking() { return _busy }

export async function pickScreenColor({ onPreview, onState } = {}) {
  if (!eyeDropperSupported() || _busy) return null
  _busy = true
  onState?.(true)

  const cleanup = { interval: null, streams: [] }
  const bridge = window.electron

  if (bridge?.eyedropperSources) {
    try {
      const [sources, displays] = await Promise.all([
        bridge.eyedropperSources(),
        bridge.eyedropperDisplays(),
      ])

      const displayData = []
      for (const src of sources) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id } },
          })
          cleanup.streams.push(stream)

          const vid = document.createElement('video')
          vid.srcObject = stream
          await new Promise((res, rej) => {
            const t = setTimeout(rej, 4000)
            vid.addEventListener('loadeddata', () => { clearTimeout(t); res() }, { once: true })
            vid.addEventListener('error', rej, { once: true })
            vid.play()
          })

          const cvs = document.createElement('canvas')
          cvs.width = vid.videoWidth
          cvs.height = vid.videoHeight
          const ctx = cvs.getContext('2d', { willReadFrequently: true })

          const display = displays.find(d => String(d.id) === src.displayId)
            ?? displays[displayData.length]
            ?? displays[0]

          displayData.push({ vid, cvs, ctx, display })
        } catch { /* skip this source if it fails */ }
      }

      if (displayData.length > 0) {
        cleanup.interval = setInterval(async () => {
          try {
            const pos = await bridge.eyedropperCursor()
            const entry = displayData.find(({ display: d }) =>
              pos.x >= d.bounds.x && pos.x < d.bounds.x + d.bounds.width &&
              pos.y >= d.bounds.y && pos.y < d.bounds.y + d.bounds.height
            ) ?? displayData[0]

            const { vid, ctx, display } = entry
            ctx.drawImage(vid, 0, 0)

            const fracX = (pos.x - display.bounds.x) / display.bounds.width
            const fracY = (pos.y - display.bounds.y) / display.bounds.height
            const px = Math.max(0, Math.min(entry.cvs.width - 1, Math.round(fracX * entry.cvs.width)))
            const py = Math.max(0, Math.min(entry.cvs.height - 1, Math.round(fracY * entry.cvs.height)))

            const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
            const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
            onPreview?.(hex)
          } catch { /* ignore transient IPC failures */ }
        }, 33) // ~30 fps
      }
    } catch { /* bridge not available or permission denied — fall through */ }
  }

  let picked = null
  try {
    const result = await new window.EyeDropper().open()
    if (result?.sRGBHex) picked = result.sRGBHex
  } catch { /* user pressed Escape */ }

  if (cleanup.interval) clearInterval(cleanup.interval)
  cleanup.streams.forEach(s => s.getTracks().forEach(t => t.stop()))
  _busy = false
  onState?.(false)
  return picked
}
