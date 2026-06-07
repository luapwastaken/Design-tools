import { useState, useMemo } from 'react'
import { C } from './ui.jsx'
import { computeLayout } from './layout.js'
import { hexToRgb } from '../../lib/color.js'

// ── TintFilter ────────────────────────────────────────────────────────────────
export function TintFilter({ id, hex }) {
  if (!hex || hex.length < 7) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return (
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={`0 0 0 0 ${r.toFixed(4)}  0 0 0 0 ${g.toFixed(4)}  0 0 0 0 ${b.toFixed(4)}  0 0 0 1 0`} />
    </filter>
  )
}

// ── TreatmentFilter ───────────────────────────────────────────────────────────
export function TreatmentFilter({ id, treatment, spotColor, duotoneDark, duotoneLight }) {
  const attrs = { id, x: '0%', y: '0%', width: '100%', height: '100%', colorInterpolationFilters: 'sRGB' }

  if (treatment === 'mono-black') {
    return (
      <filter {...attrs}>
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
      </filter>
    )
  }

  if (treatment === 'mono-white' || treatment === 'knockout') {
    return (
      <filter {...attrs}>
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
      </filter>
    )
  }

  if (treatment === 'single-spot') {
    const hex = spotColor || '#000000'
    const [r, g, b] = hexToRgb(hex)
    const rf = (r / 255).toFixed(4), gf = (g / 255).toFixed(4), bf = (b / 255).toFixed(4)
    return (
      <filter {...attrs}>
        <feColorMatrix type="matrix" values={`0 0 0 0 ${rf}  0 0 0 0 ${gf}  0 0 0 0 ${bf}  0 0 0 1 0`} />
      </filter>
    )
  }

  if (treatment === 'duotone') {
    const dark = duotoneDark || '#000000'
    const light = duotoneLight || '#ffffff'
    const [dr, dg, db] = hexToRgb(dark)
    const [lr, lg, lb] = hexToRgb(light)
    const sr = ((lr - dr) / 255).toFixed(4), ir = (dr / 255).toFixed(4)
    const sg = ((lg - dg) / 255).toFixed(4), ig = (dg / 255).toFixed(4)
    const sb = ((lb - db) / 255).toFixed(4), ib = (db / 255).toFixed(4)
    return (
      <filter {...attrs}>
        <feColorMatrix type="saturate" values="0" result="gray" />
        <feComponentTransfer in="gray">
          <feFuncR type="linear" slope={sr} intercept={ir} />
          <feFuncG type="linear" slope={sg} intercept={ig} />
          <feFuncB type="linear" slope={sb} intercept={ib} />
        </feComponentTransfer>
      </filter>
    )
  }

  return null
}

// ── Drag handle ───────────────────────────────────────────────────────────────
export function Handle({ cx, cy, size, onMouseDown }) {
  const [hov, setHov] = useState(false)
  return (
    <rect data-handles="true"
      x={cx - size / 2} y={cy - size / 2} width={size} height={size}
      rx={size * 0.2}
      fill={hov ? C.accent : C.panel}
      stroke={C.accent} strokeWidth={size * 0.12}
      style={{ cursor: 'nwse-resize' }}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    />
  )
}

// ── LockupSvg ─────────────────────────────────────────────────────────────────
export function LockupSvg({
  layout, icon, wordmark,
  iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
  showGuides, guideColor, showSafeZone,
  iconScale, gapRatio, alignment,
  padding = 0.38, style, svgRef, children,
  // New treatment props
  treatment = 'original',
  treatmentSpotColor,
  treatmentDuotoneDark,
  treatmentDuotoneLight,
  // New clearspace props
  showClearspace = false,
  clearspaceN = 0.5,
}) {
  const effectiveLayout = !icon ? 'w' : !wordmark ? 'i' : layout
  const iconAspect = icon?.aspect ?? 1
  const wordmarkAspect = wordmark?.aspect ?? 1

  const lyt = useMemo(() =>
    computeLayout({ layout: effectiveLayout, iconAspect, wordmarkAspect, iconScale, gapRatio, alignment }),
    [effectiveLayout, iconAspect, wordmarkAspect, iconScale, gapRatio, alignment]
  )

  if (!lyt) return null

  const pad = Math.max(lyt.totalW, lyt.totalH) * padding
  const vW = lyt.totalW + pad * 2
  const vH = lyt.totalH + pad * 2
  const gs = vW * 0.0022
  const gd = `${vW * 0.016} ${vW * 0.008}`
  const safeZone = lyt.totalH * 0.5

  const hasTreatment = treatment !== 'original'
  // Divider colour when no treatment active — matches the wordmark/icon colour override
  const dividerColor = wordmarkColorOn ? wordmarkColor : iconColorOn ? iconColor : '#ffffff'

  return (
    <svg ref={svgRef} viewBox={`0 0 ${vW} ${vH}`} style={style} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {!hasTreatment && iconColorOn && icon && <TintFilter id="tint-icon" hex={iconColor} />}
        {!hasTreatment && wordmarkColorOn && wordmark && <TintFilter id="tint-wm" hex={wordmarkColor} />}
        {hasTreatment && (
          <TreatmentFilter
            id="treatment"
            treatment={treatment}
            spotColor={treatmentSpotColor}
            duotoneDark={treatmentDuotoneDark}
            duotoneLight={treatmentDuotoneLight}
          />
        )}
      </defs>

      {/* Clearspace overlay — rendered before other guide lines */}
      {showClearspace && (
        <rect data-guides="true"
          x={pad - clearspaceN * lyt.totalH}
          y={pad - clearspaceN * lyt.totalH}
          width={lyt.totalW + 2 * clearspaceN * lyt.totalH}
          height={lyt.totalH + 2 * clearspaceN * lyt.totalH}
          stroke="#ff6b6b" strokeWidth={gs * 1.5}
          fill="none" opacity={0.5}
          strokeDasharray={gd}
        />
      )}

      {/* Safe zone — data-guides so export can include/exclude */}
      {showSafeZone && (
        <rect data-guides="true"
          x={pad - safeZone} y={pad - safeZone}
          width={lyt.totalW + safeZone * 2} height={lyt.totalH + safeZone * 2}
          fill="none" stroke={guideColor} strokeWidth={gs}
          strokeDasharray={`${vW * 0.012} ${vW * 0.006}`} opacity={0.35}
        />
      )}

      {/* Guide lines */}
      {showGuides && (
        <g data-guides="true" stroke={guideColor} strokeWidth={gs} fill="none" strokeDasharray={gd} opacity={0.55}>
          <line x1={vW / 2} y1={0} x2={vW / 2} y2={vH} />
          <line x1={0} y1={vH / 2} x2={vW} y2={vH / 2} />
          <rect x={pad} y={pad} width={lyt.totalW} height={lyt.totalH} />
          {lyt.icon && icon && (
            <rect x={pad + lyt.icon.x} y={pad + lyt.icon.y} width={lyt.icon.w} height={lyt.icon.h} opacity={0.4} />
          )}
          {lyt.wordmark && wordmark && (
            <rect x={pad + lyt.wordmark.x} y={pad + lyt.wordmark.y} width={lyt.wordmark.w} height={lyt.wordmark.h} opacity={0.4} />
          )}
        </g>
      )}

      {/* Knockout background rect — rendered BEFORE the filtered group */}
      {hasTreatment && treatment === 'knockout' && (
        <rect fill={treatmentSpotColor} width={vW} height={vH} />
      )}

      {hasTreatment ? (
        <g filter="url(#treatment)">
          {lyt.icon && icon && (
            <image href={icon.dataUrl}
              x={pad + lyt.icon.x} y={pad + lyt.icon.y}
              width={lyt.icon.w} height={lyt.icon.h}
              preserveAspectRatio="xMidYMid meet"
            />
          )}
          {lyt.wordmark && wordmark && (
            <image href={wordmark.dataUrl}
              x={pad + lyt.wordmark.x} y={pad + lyt.wordmark.y}
              width={lyt.wordmark.w} height={lyt.wordmark.h}
              preserveAspectRatio="xMidYMid meet"
            />
          )}
          {lyt.divider && (
            <rect x={pad + lyt.divider.x} y={pad + lyt.divider.y}
              width={lyt.divider.w} height={lyt.divider.h} fill="#ffffff" />
          )}
        </g>
      ) : (
        <>
          {lyt.icon && icon && (
            <image href={icon.dataUrl}
              x={pad + lyt.icon.x} y={pad + lyt.icon.y}
              width={lyt.icon.w} height={lyt.icon.h}
              preserveAspectRatio="xMidYMid meet"
              filter={iconColorOn ? 'url(#tint-icon)' : undefined}
            />
          )}
          {lyt.wordmark && wordmark && (
            <image href={wordmark.dataUrl}
              x={pad + lyt.wordmark.x} y={pad + lyt.wordmark.y}
              width={lyt.wordmark.w} height={lyt.wordmark.h}
              preserveAspectRatio="xMidYMid meet"
              filter={wordmarkColorOn ? 'url(#tint-wm)' : undefined}
            />
          )}
          {lyt.divider && (
            <rect x={pad + lyt.divider.x} y={pad + lyt.divider.y}
              width={lyt.divider.w} height={lyt.divider.h} fill={dividerColor} />
          )}
        </>
      )}

      {children}
    </svg>
  )
}
