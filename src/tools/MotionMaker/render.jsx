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
function xmlEscape(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
const textAnchor = (align) => align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'

// hex (#rgb / #rrggbb) → [r,g,b] in 0..1
function hexRgb(hex) {
  let h = String(hex || '#000').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

// Backdrop gradient → <linearGradient>/<radialGradient> markup (shared by both render
// paths). objectBoundingBox units, so coords are 0..1 over the rect.
function gradientDef(it, gid) {
  const stops = `<stop offset="0" stop-color="${it.colorA}"/><stop offset="1" stop-color="${it.colorB}"/>`
  if (it.mode === 'radial') return `<radialGradient id="${gid}" cx="0.5" cy="0.5" r="0.72">${stops}</radialGradient>`
  const rad = (it.angle || 0) * Math.PI / 180
  const dx = Math.cos(rad) / 2, dy = Math.sin(rad) / 2
  return `<linearGradient id="${gid}" x1="${(0.5 - dx).toFixed(3)}" y1="${(0.5 - dy).toFixed(3)}" x2="${(0.5 + dx).toFixed(3)}" y2="${(0.5 + dy).toFixed(3)}">${stops}</linearGradient>`
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

// Build a canvas-space <mask> for an item's Mask/Reveal clip. Returns { id, def }.
function buildMask(item) {
  const c = item.clip
  if (!c) return { id: null, def: '' }
  const id = 'm_' + sanitizeId(item.id)
  const bg = c.invert ? '#fff' : '#000', fg = c.invert ? '#000' : '#fff'
  const fid = id + '_f'
  const fdef = c.feather > 0 ? `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${c.feather}"/></filter>` : ''
  const fattr = c.feather > 0 ? ` filter="url(#${fid})"` : ''
  const shape = c.shape === 'ellipse'
    ? `<ellipse cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" rx="${(c.w / 2).toFixed(2)}" ry="${(c.h / 2).toFixed(2)}" fill="${fg}"${fattr}/>`
    : `<rect x="${(c.x - c.w / 2).toFixed(2)}" y="${(c.y - c.h / 2).toFixed(2)}" width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}" fill="${fg}"${fattr}/>`
  const def = `${fdef}<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${c.cw}" height="${c.ch}"><rect x="0" y="0" width="${c.cw}" height="${c.ch}" fill="${bg}"/>${shape}</mask>`
  return { id, def }
}

// ── String path (export) ─────────────────────────────────────────────────────────
// An item → SVG markup, wrapped in an untransformed mask group when it has a clip
// (the mask is in canvas space, so it must sit outside the item's own transform).
function itemSvg(it, filterId, maskId) {
  const inner = itemSvgInner(it, filterId)
  return maskId ? `<g mask="url(#${maskId})">${inner}</g>` : inner
}

// One scene item → SVG markup. Objects are positioned by centre, rotated about it.
function itemSvgInner(it, filterId) {
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
  if (it.kind === 'backdrop') {
    const useGrad = it.mode !== 'solid' && it.colorB
    const gid = 'bg_' + sanitizeId(it.id)
    const defs = useGrad ? `<defs>${gradientDef(it, gid)}</defs>` : ''
    const rect = `<rect x="${(-it.w / 2).toFixed(2)}" y="${(-it.h / 2).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}" fill="${useGrad ? `url(#${gid})` : it.colorA}"/>`
    return `<g transform="${t}" opacity="${it.opacity}"${fAttr}${bAttr}>${defs}${rect}</g>`
  }
  if (it.kind === 'text') {
    const tx = `<text x="0" y="0" font-family="${it.font || 'system-ui'}" font-size="${it.h}" font-weight="${it.weight || 700}" fill="${it.fill}" text-anchor="${textAnchor(it.align)}" dominant-baseline="central" letter-spacing="${it.tracking || 0}" style="white-space:pre">${xmlEscape(it.string || '')}</text>`
    return `<g transform="${t}" opacity="${it.opacity}"${fAttr}${bAttr}>${tx}</g>`
  }
  if (it.kind === 'fragment') {
    // a shard of an image: clip a full-size image down to this piece's cell
    const cp = 'cp_' + sanitizeId(it.id)
    const clip = `<clipPath id="${cp}"><rect x="${(-it.w / 2).toFixed(2)}" y="${(-it.h / 2).toFixed(2)}" width="${it.w.toFixed(2)}" height="${it.h.toFixed(2)}"/></clipPath>`
    const image = `<image href="${it.href}" x="${(it.imgCX - it.imgW / 2).toFixed(2)}" y="${(it.imgCY - it.imgH / 2).toFixed(2)}" width="${it.imgW.toFixed(2)}" height="${it.imgH.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`
    return `<g transform="${t}" opacity="${it.opacity}"${fAttr}${bAttr}>${clip}<g clip-path="url(#${cp})">${image}</g></g>`
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
    const f = buildFilter(it); if (f.def) defs.push(f.def)
    const m = buildMask(it); if (m.def) defs.push(m.def)
    return itemSvg(it, f.id, m.id)
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
  const maskIds = items.map(it => { const m = buildMask(it); if (m.def) defs.push(m.def); return m.id })
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
        let el = null
        if (it.kind === 'image') {
          el = <g {...gProps}><image href={it.href} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} preserveAspectRatio="xMidYMid meet" /></g>
        } else if (it.kind === 'shape') {
          el = <g {...gProps}>{it.shape === 'ellipse'
            ? <ellipse cx={0} cy={0} rx={it.w / 2} ry={it.h / 2} fill={it.color} />
            : <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} fill={it.color} />}</g>
        } else if (it.kind === 'backdrop') {
          const useGrad = it.mode !== 'solid' && it.colorB
          const gid = 'bg_' + sanitizeId(it.id)
          el = <g {...gProps}>{useGrad && <defs dangerouslySetInnerHTML={{ __html: gradientDef(it, gid) }} />}
            <rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} fill={useGrad ? `url(#${gid})` : it.colorA} /></g>
        } else if (it.kind === 'text') {
          el = <g {...gProps}><text x={0} y={0} fontFamily={it.font || 'system-ui'} fontSize={it.h} fontWeight={it.weight || 700}
            fill={it.fill} textAnchor={textAnchor(it.align)} dominantBaseline="central"
            letterSpacing={it.tracking || 0} style={{ whiteSpace: 'pre' }}>{it.string}</text></g>
        } else if (it.kind === 'fragment') {
          const cp = 'cp_' + sanitizeId(it.id)
          el = <g {...gProps}><clipPath id={cp}><rect x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} /></clipPath>
            <g clipPath={`url(#${cp})`}><image href={it.href} x={it.imgCX - it.imgW / 2} y={it.imgCY - it.imgH / 2}
              width={it.imgW} height={it.imgH} preserveAspectRatio="xMidYMid meet" /></g></g>
        } else return null
        // wrap in an untransformed group carrying the canvas-space mask, if any
        return <g key={it.id || i} mask={maskIds[i] ? `url(#${maskIds[i]})` : undefined}>{el}</g>
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
