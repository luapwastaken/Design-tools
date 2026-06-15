// ── Motion Maker — scene renderer ──────────────────────────────────────────────
//
// Turns a render list (from engine.evaluateScene) into pixels. Two consumers share
// this so preview and export never diverge:
//   • <SceneSvg> — live React/SVG preview at the current frame.
//   • sceneToSvgString / rasterizeScene — string + canvas paths for exporters.
//
// Appearance effects (unlock 3): items may carry an `fx` chain and a `blend` field.
// buildFilter() compiles the chain into a single stacked <filter>; both render paths
// emit the exact same filter markup so the live preview matches the export frame.

const clampNum = (v, a, b) => Math.min(b, Math.max(a, v))

// ── Effect filters ───────────────────────────────────────────────────────────────
function sanitizeId(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, '_') }

// hex (#rgb / #rrggbb) → [r,g,b] in 0..1
function hexRgb(hex) {
  let h = String(hex || '#000').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

// One effect → SVG filter-primitive markup reading `IN`, writing `OUT`.
function fxPrimitive(e, IN, OUT) {
  switch (e.type) {
    case 'blur': {
      const r = Math.max(0, e.radius || 0)
      const sd = e.direction === 'horizontal' ? `${r} 0` : e.direction === 'vertical' ? `0 ${r}` : `${r}`
      return `<feGaussianBlur in="${IN}" stdDeviation="${sd}" result="${OUT}"/>`
    }
    case 'tint': {
      if (e.mode === 'hue-shift') {
        return `<feColorMatrix in="${IN}" type="hueRotate" values="${e.hueShift || 0}" result="${OUT}"/>`
      }
      if (e.mode === 'replace') {
        const a = clampNum(e.amount ?? 1, 0, 1)
        // semi-transparent flood clipped to the shape, composited over the original
        return `<feFlood flood-color="${e.color}" flood-opacity="${a}" result="${OUT}_f"/>` +
               `<feComposite in="${OUT}_f" in2="${IN}" operator="in" result="${OUT}_c"/>` +
               `<feMerge result="${OUT}"><feMergeNode in="${IN}"/><feMergeNode in="${OUT}_c"/></feMerge>`
      }
      // multiply: scale each channel toward the tint colour by `amount`
      const a = clampNum(e.amount ?? 1, 0, 1)
      const [r, g, b] = hexRgb(e.color)
      const cr = (1 - a) + a * r, cg = (1 - a) + a * g, cb = (1 - a) + a * b
      const m = `${cr} 0 0 0 0  0 ${cg} 0 0 0  0 0 ${cb} 0 0  0 0 0 1 0`
      return `<feColorMatrix in="${IN}" type="matrix" values="${m}" result="${OUT}"/>`
    }
    case 'glow': {
      const r = Math.max(0, e.radius || 0)
      const i = clampNum(e.intensity ?? 0.8, 0, 1)
      return `<feGaussianBlur in="${IN}" stdDeviation="${r}" result="${OUT}_b"/>` +
             `<feFlood flood-color="${e.color || '#fff'}" flood-opacity="${i}" result="${OUT}_c"/>` +
             `<feComposite in="${OUT}_c" in2="${OUT}_b" operator="in" result="${OUT}_g"/>` +
             `<feMerge result="${OUT}"><feMergeNode in="${OUT}_g"/><feMergeNode in="${IN}"/></feMerge>`
    }
    case 'dropShadow':
      return `<feDropShadow in="${IN}" dx="${e.dx || 0}" dy="${e.dy || 0}" stdDeviation="${Math.max(0, e.blur || 0)}" flood-color="${e.color || '#000'}" flood-opacity="${clampNum(e.opacity ?? 0.5, 0, 1)}" result="${OUT}"/>`
    case 'glitch': {
      // block displacement (horizontal tears) → RGB channel split, recombined by screen.
      const disp = e.displace || 0, split = e.rgbSplit || 0, seed = e.seed || 0
      const R = 'matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'
      const G = 'matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'
      const B = 'matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'
      return (
        `<feTurbulence type="fractalNoise" baseFrequency="0 ${e.blockFreqY || 0.35}" numOctaves="1" seed="${seed}" result="${OUT}_t"/>` +
        `<feDisplacementMap in="${IN}" in2="${OUT}_t" scale="${disp}" xChannelSelector="R" yChannelSelector="G" result="${OUT}_d"/>` +
        `<feColorMatrix in="${OUT}_d" type="${R}" result="${OUT}_r"/>` +
        `<feOffset in="${OUT}_r" dx="${split}" dy="0" result="${OUT}_ro"/>` +
        `<feColorMatrix in="${OUT}_d" type="${G}" result="${OUT}_g"/>` +
        `<feColorMatrix in="${OUT}_d" type="${B}" result="${OUT}_b"/>` +
        `<feOffset in="${OUT}_b" dx="${-split}" dy="0" result="${OUT}_bo"/>` +
        `<feBlend mode="screen" in="${OUT}_ro" in2="${OUT}_g" result="${OUT}_rg"/>` +
        `<feBlend mode="screen" in="${OUT}_rg" in2="${OUT}_bo" result="${OUT}"/>`
      )
    }
    case 'dither': {
      if (e.mode === 'ordered') {
        const n = Math.max(2, e.levels || 4)
        const tbl = Array.from({ length: n }, (_, i) => (i / (n - 1)).toFixed(3)).join(' ')
        return `<feComponentTransfer in="${IN}" result="${OUT}"><feFuncR type="discrete" tableValues="${tbl}"/><feFuncG type="discrete" tableValues="${tbl}"/><feFuncB type="discrete" tableValues="${tbl}"/></feComponentTransfer>`
      }
      // noise dissolve: threshold a fixed turbulence field by `reveal` to mask the source
      // in — the logo resolving through a dither pattern.
      const shift = (clampNum(e.reveal ?? 1, 0, 1) - 0.5).toFixed(3)
      return (
        `<feTurbulence type="fractalNoise" baseFrequency="${e.cells || 0.06}" numOctaves="2" seed="${e.seed || 0}" stitchTiles="stitch" result="${OUT}_n"/>` +
        `<feColorMatrix in="${OUT}_n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.33 0 0" result="${OUT}_a"/>` +
        `<feComponentTransfer in="${OUT}_a" result="${OUT}_sh"><feFuncA type="linear" slope="1" intercept="${shift}"/></feComponentTransfer>` +
        `<feComponentTransfer in="${OUT}_sh" result="${OUT}_m"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>` +
        `<feComposite in="${IN}" in2="${OUT}_m" operator="in" result="${OUT}"/>`
      )
    }
    default:
      return ''
  }
}

// Compile an item's fx chain into one <filter>. Returns { id, def } (def '' if none).
function buildFilter(item) {
  const fx = item.fx
  if (!fx || !fx.length) return { id: null, def: '' }
  const id = 'fx_' + sanitizeId(item.id)
  let prev = 'SourceGraphic', prims = ''
  fx.forEach((e, i) => { const out = 'r' + i; prims += fxPrimitive(e, prev, out); prev = out })
  // generous region so blur / glow / shadow aren't clipped
  const def = `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">${prims}</filter>`
  return { id, def }
}

// ── String path (export) ─────────────────────────────────────────────────────────
// One scene item → SVG markup. Objects are positioned by centre, rotated about it.
function itemSvg(it, filterId) {
  const t = `translate(${it.x.toFixed(2)} ${it.y.toFixed(2)}) rotate(${(it.rotate || 0).toFixed(3)})`
  const fAttr = filterId ? ` filter="url(#${filterId})"` : ''
  const bAttr = it.blend && it.blend !== 'normal' ? ` style="mix-blend-mode:${it.blend}"` : ''
  if (it.kind === 'image') {
    return `<g transform="${t}" opacity="${it.opacity}"${fAttr}${bAttr}><image href="${it.href}" x="${(-it.w / 2).toFixed(2)}" y="${(-it.h / 2).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/></g>`
  }
  if (it.kind === 'shape') {
    const inner = it.shape === 'ellipse'
      ? `<ellipse cx="0" cy="0" rx="${(it.w / 2).toFixed(2)}" ry="${(it.h / 2).toFixed(2)}" fill="${it.color}"/>`
      : `<rect x="${(-it.w / 2).toFixed(2)}" y="${(-it.h / 2).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}" fill="${it.color}"/>`
    return `<g transform="${t}" opacity="${it.opacity}"${fAttr}${bAttr}>${inner}</g>`
  }
  return ''
}

// Full standalone SVG document string for a scene (used for export rasterization).
export function sceneToSvgString(scene, { bg } = {}) {
  const { canvas, items } = scene
  const bgRect = bg && bg !== 'transparent'
    ? `<rect width="${canvas.w}" height="${canvas.h}" fill="${bg}"/>` : ''
  const defs = []
  const body = items.map(it => {
    const { id, def } = buildFilter(it)
    if (def) defs.push(def)
    return itemSvg(it, id)
  }).join('')
  const defsBlock = defs.length ? `<defs>${defs.join('')}</defs>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.w} ${canvas.h}" width="${canvas.w}" height="${canvas.h}">${bgRect}${defsBlock}${body}</svg>`
}

// ── React path (preview) ─────────────────────────────────────────────────────────
// Same geometry + identical filter markup (injected as raw defs) as the string path.
export function SceneSvg({ scene, style }) {
  const { canvas, items } = scene
  const defs = []
  const filterIds = items.map(it => { const f = buildFilter(it); if (f.def) defs.push(f.def); return f.id })
  return (
    <svg viewBox={`0 0 ${canvas.w} ${canvas.h}`} style={style} xmlns="http://www.w3.org/2000/svg">
      {defs.length > 0 && <defs dangerouslySetInnerHTML={{ __html: defs.join('') }} />}
      {items.map((it, i) => {
        const t = `translate(${it.x} ${it.y}) rotate(${it.rotate || 0})`
        const filterId = filterIds[i]
        const gProps = {
          transform: t, opacity: it.opacity,
          filter: filterId ? `url(#${filterId})` : undefined,
          style: it.blend && it.blend !== 'normal' ? { mixBlendMode: it.blend } : undefined,
        }
        if (it.kind === 'image') {
          return (
            <g key={it.id || i} {...gProps}>
              <image href={it.href} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h}
                preserveAspectRatio="xMidYMid meet" />
            </g>
          )
        }
        if (it.kind === 'shape') {
          return (
            <g key={it.id || i} {...gProps}>
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
