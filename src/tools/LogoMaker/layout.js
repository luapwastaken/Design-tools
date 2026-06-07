// ── Layout ────────────────────────────────────────────────────────────────────

export const VARIATIONS = [
  { id: 'horizontal',      label: 'Horizontal',     layout: 'h',   previewOnly: false },
  { id: 'horizontal-rev',  label: 'Horiz. Rev.',    layout: 'hr',  previewOnly: false },
  { id: 'vertical',        label: 'Vertical',        layout: 'v',   previewOnly: false },
  { id: 'vertical-rev',    label: 'Word on Top',     layout: 'vr',  previewOnly: false },
  { id: 'inline',          label: 'Inline',          layout: 'il',  previewOnly: false },
  { id: 'inline-rev',      label: 'Inline Rev.',     layout: 'ilr', previewOnly: false },
  { id: 'divided-h',       label: 'Divided',         layout: 'dh',  previewOnly: false },
  { id: 'divided-h-rev',   label: 'Divided Rev.',    layout: 'dhr', previewOnly: false },
  { id: 'superscript',     label: 'Superscript',     layout: 'sup', previewOnly: false },
  { id: 'subscript',       label: 'Subscript',       layout: 'sub', previewOnly: false },
  { id: 'compact-stacked', label: 'Compact Stack',   layout: 'cs',  previewOnly: false },
  { id: 'icon-only',       label: 'Icon Only',       layout: 'i',   previewOnly: true  },
  { id: 'wordmark-only',   label: 'Wordmark Only',   layout: 'w',   previewOnly: true  },
]

// All layouts that require both icon and wordmark
export const BOTH_LAYOUTS = ['h', 'hr', 'v', 'vr', 'il', 'ilr', 'dh', 'dhr', 'sup', 'sub', 'cs']

// Layout — wordmark height = 1 unit
export function computeLayout({ layout, iconAspect, wordmarkAspect, iconScale, gapRatio, alignment }) {
  const wH = 1, wW = wH * wordmarkAspect
  const iH = iconScale, iW = iH * iconAspect
  const gap = gapRatio

  // ── Horizontal: icon left, wordmark right ─────────────────────────────────
  if (layout === 'h') {
    const totalW = iW + gap + wW, totalH = Math.max(iH, wH)
    const iy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - iH : (totalH - iH) / 2
    const wy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - wH : (totalH - wH) / 2
    return { totalW, totalH, icon: { x: 0, y: iy, w: iW, h: iH }, wordmark: { x: iW + gap, y: wy, w: wW, h: wH } }
  }

  // ── Horizontal Reversed: wordmark left, icon right ────────────────────────
  if (layout === 'hr') {
    const totalW = wW + gap + iW, totalH = Math.max(iH, wH)
    const wy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - wH : (totalH - wH) / 2
    const iy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - iH : (totalH - iH) / 2
    return { totalW, totalH, icon: { x: wW + gap, y: iy, w: iW, h: iH }, wordmark: { x: 0, y: wy, w: wW, h: wH } }
  }

  // ── Vertical: icon top, wordmark bottom ───────────────────────────────────
  if (layout === 'v') {
    const totalW = Math.max(iW, wW), totalH = iH + gap + wH
    const ix = alignment === 'left' ? 0 : alignment === 'right' ? totalW - iW : (totalW - iW) / 2
    const wx = alignment === 'left' ? 0 : alignment === 'right' ? totalW - wW : (totalW - wW) / 2
    return { totalW, totalH, icon: { x: ix, y: 0, w: iW, h: iH }, wordmark: { x: wx, y: iH + gap, w: wW, h: wH } }
  }

  // ── Vertical Reversed: wordmark top, icon bottom ──────────────────────────
  if (layout === 'vr') {
    const totalW = Math.max(iW, wW), totalH = wH + gap + iH
    const wx = alignment === 'left' ? 0 : alignment === 'right' ? totalW - wW : (totalW - wW) / 2
    const ix = alignment === 'left' ? 0 : alignment === 'right' ? totalW - iW : (totalW - iW) / 2
    return { totalW, totalH, icon: { x: ix, y: wH + gap, w: iW, h: iH }, wordmark: { x: wx, y: 0, w: wW, h: wH } }
  }

  // ── Inline: icon at text height, left ─────────────────────────────────────
  if (layout === 'il') {
    const ilIH = wH, ilIW = ilIH * iconAspect
    const totalW = ilIW + gap + wW, totalH = wH
    return { totalW, totalH, icon: { x: 0, y: 0, w: ilIW, h: ilIH }, wordmark: { x: ilIW + gap, y: 0, w: wW, h: wH } }
  }

  // ── Inline Reversed: wordmark left, icon at text height, right ────────────
  if (layout === 'ilr') {
    const ilIH = wH, ilIW = ilIH * iconAspect
    const totalW = wW + gap + ilIW, totalH = wH
    return { totalW, totalH, icon: { x: wW + gap, y: 0, w: ilIW, h: ilIH }, wordmark: { x: 0, y: 0, w: wW, h: wH } }
  }

  // ── Divided Horizontal: icon | rule | wordmark ────────────────────────────
  if (layout === 'dh') {
    const totalW = iW + gap + wW, totalH = Math.max(iH, wH)
    const iy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - iH : (totalH - iH) / 2
    const wy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - wH : (totalH - wH) / 2
    const ruleW = totalH * 0.015
    const ruleX = iW + gap / 2 - ruleW / 2
    return {
      totalW, totalH,
      icon: { x: 0, y: iy, w: iW, h: iH },
      wordmark: { x: iW + gap, y: wy, w: wW, h: wH },
      divider: { x: ruleX, y: 0, w: ruleW, h: totalH },
    }
  }

  // ── Divided Horizontal Reversed: wordmark | rule | icon ───────────────────
  if (layout === 'dhr') {
    const totalW = wW + gap + iW, totalH = Math.max(iH, wH)
    const wy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - wH : (totalH - wH) / 2
    const iy = alignment === 'top' ? 0 : alignment === 'bottom' ? totalH - iH : (totalH - iH) / 2
    const ruleW = totalH * 0.015
    const ruleX = wW + gap / 2 - ruleW / 2
    return {
      totalW, totalH,
      icon: { x: wW + gap, y: iy, w: iW, h: iH },
      wordmark: { x: 0, y: wy, w: wW, h: wH },
      divider: { x: ruleX, y: 0, w: ruleW, h: totalH },
    }
  }

  // ── Superscript: wordmark dominant, icon floats top-right ─────────────────
  if (layout === 'sup') {
    const totalW = Math.max(wW, iW)
    const ix = totalW - iW   // right-aligned
    const iy = 0
    const wx = 0
    const wy = iH + gap * 0.5
    const totalH = iH + gap * 0.5 + wH
    return { totalW, totalH, icon: { x: ix, y: iy, w: iW, h: iH }, wordmark: { x: wx, y: wy, w: wW, h: wH } }
  }

  // ── Subscript: wordmark dominant, icon floats bottom-right ────────────────
  if (layout === 'sub') {
    const totalW = Math.max(wW, iW)
    const wx = 0
    const wy = 0
    const ix = totalW - iW   // right-aligned
    const iy = wH + gap * 0.5
    const totalH = wH + gap * 0.5 + iH
    return { totalW, totalH, icon: { x: ix, y: iy, w: iW, h: iH }, wordmark: { x: wx, y: wy, w: wW, h: wH } }
  }

  // ── Compact Stack: wordmark scaled to span icon width ────────────────────
  if (layout === 'cs') {
    const csWW = iW
    const csWH = csWW / wordmarkAspect
    const totalW = iW
    const totalH = iH + gap + csWH
    return { totalW, totalH, icon: { x: 0, y: 0, w: iW, h: iH }, wordmark: { x: 0, y: iH + gap, w: csWW, h: csWH } }
  }

  // ── Icon only / Wordmark only ─────────────────────────────────────────────
  if (layout === 'i') return { totalW: iW, totalH: iH, icon: { x: 0, y: 0, w: iW, h: iH }, wordmark: null }
  return { totalW: wW, totalH: wH, icon: null, wordmark: { x: 0, y: 0, w: wW, h: wH } }
}
