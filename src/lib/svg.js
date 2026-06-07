// ── SVG utilities ─────────────────────────────────────────────────────────────

export function svgToDataUrl(text) {
  try {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)))
  } catch {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
  }
}

export function parseSvgText(text) {
  const vbMatch = text.match(/viewBox=["']([^"']+)["']/)
  let vw, vh
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/)
    vw = parseFloat(parts[2]); vh = parseFloat(parts[3])
  } else {
    const wm = text.match(/\bwidth=["']?([0-9.]+)["']?/)
    const hm = text.match(/\bheight=["']?([0-9.]+)["']?/)
    if (!wm || !hm) return null
    vw = parseFloat(wm[1]); vh = parseFloat(hm[1])
  }
  if (!vw || !vh || isNaN(vw) || isNaN(vh)) return null
  return { vw, vh, aspect: vw / vh, dataUrl: svgToDataUrl(text), raw: text }
}

export function isSvgLikelyBlack(svgText) {
  if (typeof svgText !== 'string') return false
  if (/fill\s*[=:]\s*['"]?\s*(?:#000(?:000)?|black)\b/i.test(svgText)) return true
  if (!/\bfill\b/i.test(svgText)) return true  // no fill = SVG default black
  return false
}

/**
 * Returns SVG filter markup string for use in string-based SVG export.
 * @param {string} treatment
 * @param {string} spotColor   hex e.g. '#e63946'
 * @param {string} duotoneDark hex
 * @param {string} duotoneLight hex
 * @returns {string} SVG filter element markup (empty string for 'original')
 */
export function buildTreatmentFilterStr(treatment, spotColor, duotoneDark, duotoneLight) {
  const attrs = `id="treatment" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"`

  if (treatment === 'mono-black') {
    return `<filter ${attrs}><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>`
  }

  if (treatment === 'mono-white' || treatment === 'knockout') {
    return `<filter ${attrs}><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>`
  }

  if (treatment === 'single-spot') {
    const hex = spotColor || '#000000'
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    return `<filter ${attrs}><feColorMatrix type="matrix" values="0 0 0 0 ${r.toFixed(4)}  0 0 0 0 ${g.toFixed(4)}  0 0 0 0 ${b.toFixed(4)}  0 0 0 1 0"/></filter>`
  }

  if (treatment === 'duotone') {
    const dark = duotoneDark || '#000000'
    const light = duotoneLight || '#ffffff'
    const dr = parseInt(dark.slice(1, 3), 16) / 255
    const dg = parseInt(dark.slice(3, 5), 16) / 255
    const db = parseInt(dark.slice(5, 7), 16) / 255
    const lr = parseInt(light.slice(1, 3), 16) / 255
    const lg = parseInt(light.slice(3, 5), 16) / 255
    const lb = parseInt(light.slice(5, 7), 16) / 255
    // slope = light - dark, intercept = dark
    const sr = (lr - dr).toFixed(4), ir = dr.toFixed(4)
    const sg = (lg - dg).toFixed(4), ig = dg.toFixed(4)
    const sb = (lb - db).toFixed(4), ib = db.toFixed(4)
    return `<filter ${attrs}><feColorMatrix type="saturate" values="0" result="gray"/><feComponentTransfer in="gray"><feFuncR type="linear" slope="${sr}" intercept="${ir}"/><feFuncG type="linear" slope="${sg}" intercept="${ig}"/><feFuncB type="linear" slope="${sb}" intercept="${ib}"/></feComponentTransfer></filter>`
  }

  return ''
}
