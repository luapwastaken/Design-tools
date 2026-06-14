// ── Motion Maker — scene renderer ──────────────────────────────────────────────
//
// Turns a render list (from engine.evaluateScene) into pixels. Two consumers share
// this so preview and export never diverge:
//   • <SceneSvg> — live React/SVG preview at the current frame.
//   • sceneToSvgString / rasterizeScene — string + canvas paths for exporters.

// One scene item → SVG markup (used by the string builder). Objects are positioned
// by centre point, rotated about that centre.
function itemSvg(it) {
  const t = `translate(${it.x.toFixed(2)} ${it.y.toFixed(2)}) rotate(${(it.rotate || 0).toFixed(3)})`
  if (it.kind === 'image') {
    return `<g transform="${t}" opacity="${it.opacity}"><image href="${it.href}" x="${(-it.w / 2).toFixed(2)}" y="${(-it.h / 2).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/></g>`
  }
  if (it.kind === 'shape') {
    const inner = it.shape === 'ellipse'
      ? `<ellipse cx="0" cy="0" rx="${(it.w / 2).toFixed(2)}" ry="${(it.h / 2).toFixed(2)}" fill="${it.color}"/>`
      : `<rect x="${(-it.w / 2).toFixed(2)}" y="${(-it.h / 2).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}" fill="${it.color}"/>`
    return `<g transform="${t}" opacity="${it.opacity}">${inner}</g>`
  }
  return ''
}

// Full standalone SVG document string for a scene (used for export rasterization).
export function sceneToSvgString(scene, { bg } = {}) {
  const { canvas, items } = scene
  const bgRect = bg && bg !== 'transparent'
    ? `<rect width="${canvas.w}" height="${canvas.h}" fill="${bg}"/>` : ''
  const body = items.map(itemSvg).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.w} ${canvas.h}" width="${canvas.w}" height="${canvas.h}">${bgRect}${body}</svg>`
}

// React preview component — same geometry as the string builder.
export function SceneSvg({ scene, style }) {
  const { canvas, items } = scene
  return (
    <svg viewBox={`0 0 ${canvas.w} ${canvas.h}`} style={style} xmlns="http://www.w3.org/2000/svg">
      {items.map((it, i) => {
        const t = `translate(${it.x} ${it.y}) rotate(${it.rotate || 0})`
        if (it.kind === 'image') {
          return (
            <g key={it.id || i} transform={t} opacity={it.opacity}>
              <image href={it.href} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h}
                preserveAspectRatio="xMidYMid meet" />
            </g>
          )
        }
        if (it.kind === 'shape') {
          return (
            <g key={it.id || i} transform={t} opacity={it.opacity}>
              {it.shape === 'ellipse'
                ? <ellipse cx={0} cy={0} rx={it.w / 2} ry={it.h / 2} fill={it.color} />
                : <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} fill={it.color} />}
            </g>
          )
        }
        return null
      })}
    </svg>
  )
}

// Rasterize a scene to a canvas (for GIF/WebM/PNG/MP4 frame capture). `bg` of
// 'transparent' keeps alpha; otherwise the matte colour is filled first.
export function rasterizeScene(scene, ctx2d, bg) {
  return new Promise((resolve, reject) => {
    const { canvas } = scene
    const svg = sceneToSvgString(scene, { bg: 'transparent' })
    const img = new Image()
    img.onload = () => {
      ctx2d.clearRect(0, 0, canvas.w, canvas.h)
      if (bg && bg !== 'transparent') { ctx2d.fillStyle = bg; ctx2d.fillRect(0, 0, canvas.w, canvas.h) }
      ctx2d.drawImage(img, 0, 0, canvas.w, canvas.h)
      resolve()
    }
    img.onerror = reject
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}
