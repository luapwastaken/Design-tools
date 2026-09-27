import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react'
import { oklchToHex, toOklch, maxChromaInGamut, lumaOklch, oklchForLuma } from '../../lib/color.js'
import { hexToCmyk, cmykToRgb } from '../../lib/cmyk.js'
import { pickScreenColor, eyeDropperSupported } from '../../lib/eyedropper.js'
import { T, ModeChip, HexInput } from './panelUi.jsx'

const CANVAS_RES = 256
const MAX_C = 0.37

// ── OKLCH pixel math (shared by renderer and gamut clamping) ─────────────────

function oklchLinearRGB(L, C, hue) {
  const hr = hue * Math.PI / 180
  const a = C * Math.cos(hr), b = C * Math.sin(hr)
  const l_ = L + 0.3963377774*a + 0.2158037573*b
  const m_ = L - 0.1055613458*a - 0.0638541728*b
  const s_ = L - 0.0894841775*a - 1.2914855480*b
  const l3 = l_*l_*l_, m3 = m_*m_*m_, s3 = s_*s_*s_
  const X =  1.2270138511035211*l3 - 0.5577999806518222*m3 + 0.2812561489664678*s3
  const Y = -0.0405801784232806*l3 + 1.1122568696168302*m3 - 0.0716766786656012*s3
  const Z = -0.0763812845057069*l3 - 0.4214819784180127*m3 + 1.5861632204407947*s3
  return [
     3.2404542*X - 1.5371385*Y - 0.4985314*Z,
    -0.9692660*X + 1.8760108*Y + 0.0415560*Z,
     0.0556434*X - 0.2040259*Y + 1.0572252*Z,
  ]
}

function isInSRGBGamut(rl, gl, bl) {
  return rl >= -0.001 && rl <= 1.001 && gl >= -0.001 && gl <= 1.001 && bl >= -0.001 && bl <= 1.001
}

// ── Canvas renderers ─────────────────────────────────────────────────────────

// X axis: L (left=0 dark, right=1 light)
// Y axis: C (top=MAX_C chromatic, bottom=0 gray)
function renderLCPlane(canvas, hue) {
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(CANVAS_RES, CANVAS_RES)
  const d = img.data
  const gamma = u => u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
  for (let py = 0; py < CANVAS_RES; py++) {
    const C = (1 - py / (CANVAS_RES - 1)) * MAX_C
    for (let px = 0; px < CANVAS_RES; px++) {
      const L = px / (CANVAS_RES - 1)
      const [rl, gl, bl] = oklchLinearRGB(L, C, hue)
      const inGamut = isInSRGBGamut(rl, gl, bl)
      const i = (py * CANVAS_RES + px) * 4
      d[i]   = Math.round(Math.max(0, Math.min(1, gamma(rl))) * 255)
      d[i+1] = Math.round(Math.max(0, Math.min(1, gamma(gl))) * 255)
      d[i+2] = Math.round(Math.max(0, Math.min(1, gamma(bl))) * 255)
      d[i+3] = inGamut ? 255 : 160
    }
  }
  ctx.putImageData(img, 0, 0)
}

function hslToRgb01(h, s, l) {
  // h: 0-360, s: 0-1, l: 0-1
  h /= 360
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1/6 ? p+(q-p)*6*t : t < 1/2 ? q : t < 2/3 ? p+(q-p)*(2/3-t)*6 : p }
  return [f(h + 1/3), f(h), f(h - 1/3)]
}

function renderHSLPlane(canvas, hue) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  const img = ctx.createImageData(W, H)
  const d = img.data
  for (let py = 0; py < H; py++) {
    const l = 1 - py / (H - 1)
    for (let px = 0; px < W; px++) {
      const s = px / (W - 1)
      const [r, g, b] = hslToRgb01(hue, s, l)
      const i = (py * W + px) * 4
      d[i] = r * 255 | 0; d[i+1] = g * 255 | 0; d[i+2] = b * 255 | 0; d[i+3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function renderHueStrip(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  for (let px = 0; px < w; px++) {
    const hue = (px / w) * 360
    const [r, g, b] = hslToRgb01(hue, 1, 0.5)
    ctx.fillStyle = `rgb(${r*255|0},${g*255|0},${b*255|0})`
    ctx.fillRect(px, 0, 1, h)
  }
}

// ── Color space conversions ──────────────────────────────────────────────────

function hexToRgb01(hex) {
  return [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255]
}

function rgb01ToHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0')).join('')
}

function rgb255ToHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')
}

function hexToHsl(hex) {
  const [r,g,b] = hexToRgb01(hex)
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min
  const l = (max + min) / 2
  let h = 0, s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g-b)/d + (g<b?6:0)) / 6
    else if (max === g) h = ((b-r)/d + 2) / 6
    else h = ((r-g)/d + 4) / 6
  }
  return { h: h*360, s: s*100, l: l*100 }
}

function hslToHex(h, s, l) {
  return rgb01ToHex(...hslToRgb01(h, s/100, l/100))
}

function hexToRgb255(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
}

function cmykToHex(c, m, y, k) {
  const { r, g, b } = cmykToRgb(c, m, y, k)
  return rgb255ToHex(r, g, b)
}

// ── Channel definitions ──────────────────────────────────────────────────────

function getChannels(mode, hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return []
  switch (mode) {
    case 'HSL': { const {h,s,l} = hexToHsl(hex); return [{key:'H',value:h,max:360,step:1,dec:0},{key:'S',value:s,max:100,step:0.5,dec:1,unit:'%'},{key:'L',value:l,max:100,step:0.5,dec:1,unit:'%'}] }
    case 'RGB': { const [r,g,b] = hexToRgb255(hex); return [{key:'R',value:r,max:255,step:1,dec:0},{key:'G',value:g,max:255,step:1,dec:0},{key:'B',value:b,max:255,step:1,dec:0}] }
    case 'CMYK': { const {c,m,y,k} = hexToCmyk(hex); return [{key:'C',value:c,max:100,step:1,dec:0,unit:'%'},{key:'M',value:m,max:100,step:1,dec:0,unit:'%'},{key:'Y',value:y,max:100,step:1,dec:0,unit:'%'},{key:'K',value:k,max:100,step:1,dec:0,unit:'%'}] }
    default: return []
  }
}

function hexFromChannels(mode, channels) {
  const v = Object.fromEntries(channels.map(ch => [ch.key, ch.value]))
  switch (mode) {
    case 'HSL': return hslToHex(v.H, v.S, v.L)
    case 'RGB': return rgb255ToHex(v.R, v.G, v.B)
    case 'CMYK': return cmykToHex(v.C, v.M, v.Y, v.K)
    default: return null
  }
}

// ── Slider gradient helper ────────────────────────────────────────────────────

function getSliderGradient(colorMode, key, previewHex) {
  if (colorMode === 'RGB') {
    const [r, g, b] = hexToRgb255(previewHex)
    const from = key==='R' ? `rgb(0,${g},${b})` : key==='G' ? `rgb(${r},0,${b})` : `rgb(${r},${g},0)`
    const to   = key==='R' ? `rgb(255,${g},${b})` : key==='G' ? `rgb(${r},255,${b})` : `rgb(${r},${g},255)`
    return `linear-gradient(to right, ${from}, ${to})`
  }
  if (colorMode === 'CMYK') {
    const cmyk = hexToCmyk(previewHex)
    const from = cmykToHex(key==='C'?0:cmyk.c, key==='M'?0:cmyk.m, key==='Y'?0:cmyk.y, key==='K'?0:cmyk.k)
    const to   = cmykToHex(key==='C'?100:cmyk.c, key==='M'?100:cmyk.m, key==='Y'?100:cmyk.y, key==='K'?100:cmyk.k)
    return `linear-gradient(to right, ${from}, ${to})`
  }
  if (colorMode === 'HSL') {
    if (key === 'H') return 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
    const { h, s, l } = hexToHsl(previewHex)
    if (key === 'S') return `linear-gradient(to right, ${hslToHex(h, 0, l)}, ${hslToHex(h, 100, l)})`
    if (key === 'L') return `linear-gradient(to right, #000, ${hslToHex(h, s, 50)}, #fff)`
  }
  return 'linear-gradient(to right, #222, #888)'
}

const MODES = ['OKLCH', 'HSL', 'RGB', 'CMYK']

// ── Picker component ─────────────────────────────────────────────────────────

export default function Picker({ oklch, onChange, valueLocked = false, hueLocked = false }) {
  const lcRef  = useRef(null)
  const hueRef = useRef(null)
  const dragging = useRef(null)
  const [localOklch, setLocalOklch] = useState(oklch ?? { l: 0.65, c: 0.2, h: 220 })
  const [colorMode, setColorMode] = useState('OKLCH')

  const { l, c, h } = localOklch
  const previewHex = oklchToHex(l, c, h)
  const hsl = hexToHsl(previewHex)

  useEffect(() => { if (oklch) setLocalOklch(oklch) }, [oklch])

  // Re-render the 2D square and hue strip whenever mode or color changes.
  // useLayoutEffect runs before paint so the canvas is never blank or stale on mode switch.
  useLayoutEffect(() => {
    if (lcRef.current) {
      if      (colorMode === 'OKLCH') renderLCPlane(lcRef.current, localOklch.h)
      else if (colorMode === 'HSL')   renderHSLPlane(lcRef.current, hexToHsl(oklchToHex(localOklch.l, localOklch.c, localOklch.h)).h)
    }
    if (hueRef.current) renderHueStrip(hueRef.current)
  }, [colorMode, localOklch])

  function emit(lch) {
    // Apply locks before emitting so local state never drifts from the frozen values.
    // Value lock holds perceived value (greyscale luma) constant: L is re-solved
    // for the new hue/chroma rather than simply pinned.
    const locked = { ...lch }
    if (hueLocked) locked.h = localOklch.h
    if (valueLocked) {
      const target = lumaOklch(localOklch.l, localOklch.c, localOklch.h)
      // A (near-)black colour has no perceived value to hold — re-solving would pin
      // L at 0 and trap the picker on black. Skip the lock so it can move freely.
      if (target > 1e-3) {
        const solved = oklchForLuma(target, locked.c, locked.h)
        locked.l = solved.l
        locked.c = solved.c
      }
    }
    // Keep the colour inside the sRGB gamut: after a hue change the old chroma may
    // sit outside the triangle, so clamp C to what's reachable at this L/H.
    locked.c = Math.min(locked.c, maxChromaInGamut(locked.l, locked.h))
    // A momentarily greyscale colour has no defined hue (toOklch reports 0) — keep
    // the previous hue so dragging through grey doesn't snap the picker to red.
    if (locked.c < 1e-3) locked.h = localOklch.h
    setLocalOklch(locked)
    onChange?.(locked)
  }

  function squarePointerAt(e) {
    if (!lcRef.current) return
    const rect = lcRef.current.getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const py = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height))
    if (colorMode === 'OKLCH') {
      const newL = valueLocked ? localOklch.l : px
      const rawC = (1 - py) * MAX_C
      const newC = Math.min(rawC, maxChromaInGamut(newL, h))
      emit({ ...localOklch, l: Math.round(newL*1000)/1000, c: Math.round(newC*1000)/1000 })
    } else if (colorMode === 'HSL') {
      if (valueLocked) {
        // Value locked: the valid colours lie on the iso-value contour, so S
        // (horizontal) is the only real degree of freedom. Solve HSL lightness to
        // hold the locked value rather than taking it from the vertical drag —
        // otherwise a fast flick to the top/bottom snaps to white/black and
        // collapses the hue. Keep a little saturation so the hue always survives.
        const s = Math.max(2, px * 100)
        const target = lumaOklch(localOklch.l, localOklch.c, localOklch.h)
        let lo = 0, hi = 100
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2
          const o = toOklch(hslToHex(hsl.h, s, mid))
          if (lumaOklch(o.l, o.c, o.h) < target) lo = mid; else hi = mid
        }
        emit(toOklch(hslToHex(hsl.h, s, (lo + hi) / 2)))
      } else {
        emit(toOklch(hslToHex(hsl.h, px * 100, (1 - py) * 100)))
      }
    }
  }

  function hueStripPointerAt(e) {
    if (hueLocked || !hueRef.current) return
    const rect = hueRef.current.getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const newH = px * 360
    if (colorMode === 'OKLCH') {
      emit({ ...localOklch, h: Math.round(newH) })
    } else if (colorMode === 'HSL') {
      emit(toOklch(hslToHex(newH, hsl.s, hsl.l)))
    }
  }

  const squareHandlerRef = useRef(null)
  squareHandlerRef.current = squarePointerAt
  const hueHandlerRef = useRef(null)
  hueHandlerRef.current = hueStripPointerAt

  useEffect(() => {
    function stop()   { dragging.current = null }
    function move(e) {
      if (dragging.current === 'sq')  squareHandlerRef.current(e)
      if (dragging.current === 'hue') hueHandlerRef.current(e)
    }
    window.addEventListener('pointerup',     stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('pointermove',   move)
    return () => {
      window.removeEventListener('pointerup',     stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('pointermove',   move)
    }
  }, [])

  // Crosshair + hue thumb positions (mode-dependent)
  const crossX = colorMode === 'HSL' ? hsl.s : l * 100
  const crossY = colorMode === 'HSL' ? 100 - hsl.l : (1 - c / MAX_C) * 100
  const hueX   = colorMode === 'HSL' ? hsl.h / 360 * 100 : h / 360 * 100

  const lcCursor = (colorMode === 'OKLCH' && valueLocked) ? 'ns-resize'
                 : (colorMode === 'HSL'   && valueLocked) ? 'ew-resize'
                 : 'crosshair'

  const showSquare = colorMode === 'OKLCH' || colorMode === 'HSL'

  // Iso-value contour: the locus of (L, C) at the current hue that share the
  // locked greyscale value. With Value lock on, the crosshair rides this curve
  // as you change chroma — a clear at-a-glance signal that value is held.
  const valueCurve = useMemo(() => {
    if (!valueLocked) return null
    const target = lumaOklch(l, c, h)
    const N = 40
    const pts = []
    if (colorMode === 'OKLCH') {
      for (let i = 0; i <= N; i++) {
        const s = oklchForLuma(target, (i / N) * MAX_C, h)
        pts.push(`${(s.l * 100).toFixed(2)},${((1 - s.c / MAX_C) * 100).toFixed(2)}`)
      }
      return pts.join(' ')
    }
    if (colorMode === 'HSL') {
      // Locus of constant greyscale value across the HSL S/L square. Luma rises
      // monotonically with HSL lightness, so binary-search the L that hits the
      // target value at each saturation.
      for (let i = 0; i <= N; i++) {
        const s = (i / N) * 100
        let lo = 0, hi = 100
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2
          const o = toOklch(hslToHex(hsl.h, s, mid))
          if (lumaOklch(o.l, o.c, o.h) < target) lo = mid; else hi = mid
        }
        const hslL = (lo + hi) / 2
        pts.push(`${s.toFixed(2)},${(100 - hslL).toFixed(2)}`)
      }
      return pts.join(' ')
    }
    return null
  }, [colorMode, valueLocked, l, c, h, hsl.h])

  // OKLCH number inputs — locked channels are read-only
  function onLInput(e) { if (valueLocked) return; const v = parseFloat(e.target.value); if (!isNaN(v)) emit({ ...localOklch, l: Math.max(0, Math.min(1, v)) }) }
  function onCInput(e) { const v = parseFloat(e.target.value); if (!isNaN(v)) emit({ ...localOklch, c: Math.max(0, Math.min(MAX_C, v)) }) }
  function onHInput(e) { if (hueLocked) return; const v = parseFloat(e.target.value); if (!isNaN(v)) emit({ ...localOklch, h: ((v%360)+360)%360 }) }
  function nudge(key, field) {
    if (field === 'l' && valueLocked) return
    if (field === 'h' && hueLocked)   return
    const step  = field==='l' ? 0.01 : field==='c' ? 0.005 : 1
    const delta = (key==='ArrowUp'||key==='ArrowRight') ? step : -step
    const cur   = localOklch[field]
    const next  = Math.max(0, field==='l' ? Math.min(1, cur+delta) : field==='c' ? Math.min(MAX_C, cur+delta) : cur+delta)
    emit({ ...localOklch, [field]: Math.round(next*10000)/10000 })
  }

  const channels = colorMode !== 'OKLCH' ? getChannels(colorMode, previewHex) : []
  function handleChannelChange(key, value) {
    if (valueLocked && colorMode === 'HSL' && key === 'L') return
    const updated = channels.map(ch => ch.key === key ? { ...ch, value } : ch)
    const newHex  = hexFromChannels(colorMode, updated)
    if (newHex) emit(toOklch(newHex))
  }

  return (
    <div style={{ userSelect: 'none' }}>

      {/* Color mode tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {MODES.map(m => (
          <ModeChip key={m} active={colorMode === m} onClick={() => setColorMode(m)}>{m}</ModeChip>
        ))}
      </div>

      {/* 2D square — OKLCH, HSL, HSV only */}
      {showSquare && (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 6, overflow: 'hidden', cursor: lcCursor, background: T.panel }}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = 'sq'; squarePointerAt(e) }}>
          <canvas ref={lcRef} width={CANVAS_RES} height={CANVAS_RES}
            style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'auto' }} />
          {valueLocked && valueCurve && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', filter: 'drop-shadow(0 0 2px rgba(139,92,246,0.6))' }}>
              <polyline points={valueCurve} fill="none" stroke="rgba(139,92,246,0.85)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <div style={{ position: 'absolute', left: `calc(${crossX}% - 5px)`, top: `calc(${crossY}% - 5px)`, width: 10, height: 10, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
        </div>
      )}

      {/* Hue strip — OKLCH, HSL, HSV only */}
      {showSquare && (
        <div style={{ position: 'relative', height: 14, marginTop: 6, borderRadius: 4, overflow: 'hidden', cursor: hueLocked ? 'default' : 'ew-resize' }}
          onPointerDown={e => { if (!hueLocked) { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = 'hue'; hueStripPointerAt(e) } }}>
          <canvas ref={hueRef} width={360} height={14} style={{ width: '100%', height: 14, display: 'block' }} />
          <div style={{ position: 'absolute', left: `calc(${hueX}% - 5px)`, top: 0, width: 10, height: 14, borderRadius: 3,
            border: hueLocked ? '2px solid rgba(139,92,246,0.9)' : '2px solid #fff',
            boxShadow: hueLocked ? '0 0 0 1px rgba(0,0,0,0.4), 0 0 6px rgba(139,92,246,0.7)' : '0 0 0 1px rgba(0,0,0,0.6)',
            pointerEvents: 'none' }} />
        </div>
      )}

      {/* OKLCH number inputs */}
      {colorMode === 'OKLCH' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10 }}>
          {[
            {label:'L',value:l.toFixed(3),field:'l',onInput:onLInput,isLocked:valueLocked},
            {label:'C',value:c.toFixed(3),field:'c',onInput:onCInput,isLocked:false},
            {label:'H',value:Math.round(h),field:'h',onInput:onHInput,isLocked:hueLocked},
          ].map(({label,value,field,onInput,isLocked}) => (
            <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: T.micro, color: isLocked ? T.accentText : T.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                {label}{isLocked ? ' 🔒' : ''}
              </span>
              <input type="number" value={value} step={field==='l'?0.01:field==='c'?0.005:1}
                readOnly={isLocked}
                onChange={isLocked ? undefined : onInput}
                onKeyDown={e => { if (e.key==='ArrowUp'||e.key==='ArrowDown') { e.preventDefault(); nudge(e.key, field) } }}
                className="cp-input"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  ...(isLocked ? {
                    background: T.panel, borderColor: T.accentLine,
                    color: T.accentText, cursor: 'default',
                  } : null),
                }}
              />
            </label>
          ))}
        </div>
      )}

      {/* Gradient sliders for HSL / RGB / CMYK */}
      {colorMode !== 'OKLCH' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {valueLocked && (colorMode === 'RGB' || colorMode === 'CMYK') && (
            <div style={{
              fontSize: T.micro, color: T.accentText, background: 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.25)', borderRadius: T.r,
              padding: '4px 8px', letterSpacing: 0.3,
            }}>
              🔒 Value lock active — sliders adjust to preserve greyscale value
            </div>
          )}
          {channels.map(ch => {
            const isLocked = valueLocked && colorMode === 'HSL' && ch.key === 'L'
            return (
              <GradientSlider key={ch.key} ch={ch} colorMode={colorMode} previewHex={previewHex}
                onChange={handleChannelChange} isLocked={isLocked} />
            )
          })}
        </div>
      )}

      {/* Hex + preview + eyedropper */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
        <div style={{ width: 30, height: 30, borderRadius: 6, background: previewHex, border: `1px solid ${T.line}`, flexShrink: 0 }} />
        <HexInput value={previewHex} aria-label="Hex colour"
          onCommit={hex => emit(toOklch(hex))}
          style={{ flex: 1 }}
        />
        <EyeDropperBtn
          onPick={hex => emit(toOklch(hex))}
          onPreview={hex => setLocalOklch(toOklch(hex))}
        />
      </div>
    </div>
  )
}

// ── Gradient slider ───────────────────────────────────────────────────────────

function GradientSlider({ ch, colorMode, previewHex, onChange, isLocked = false }) {
  const gradient = getSliderGradient(colorMode, ch.key, previewHex)
  const pct = (ch.value / ch.max) * 100

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: T.label, color: isLocked ? T.accentText : T.faint, width: 18, textAlign: 'right', flexShrink: 0 }}>
        {ch.key}
      </span>
      <div style={{ flex: 1, position: 'relative', height: 12, borderRadius: 6, opacity: isLocked ? 0.45 : 1 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: gradient }} />
        <input type="range" min={0} max={ch.max} step={ch.step} value={ch.value}
          disabled={isLocked}
          onChange={isLocked ? undefined : e => onChange(ch.key, +e.target.value)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: isLocked ? 'default' : 'ew-resize', margin: 0 }}
        />
        <div style={{
          position: 'absolute', left: `${pct}%`, top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 14, height: 14, borderRadius: '50%',
          border: isLocked ? '2px solid rgba(139,92,246,0.9)' : '2px solid white',
          boxShadow: isLocked ? '0 0 6px rgba(139,92,246,0.5)' : '0 1px 3px rgba(0,0,0,0.7)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      </div>
      <input type="number" min={0} max={ch.max} step={ch.step}
        readOnly={isLocked}
        value={ch.dec === 0 ? Math.round(ch.value) : +ch.value.toFixed(ch.dec)}
        onChange={isLocked ? undefined : e => onChange(ch.key, +e.target.value)}
        className="cp-input"
        style={{
          width: 56, textAlign: 'right', boxSizing: 'border-box',
          ...(isLocked ? {
            background: T.panel, borderColor: T.accentLine,
            color: T.accentText, cursor: 'default',
          } : null),
        }}
      />
      {ch.unit && <span style={{ fontSize: T.micro, color: T.faint, width: 10, flexShrink: 0 }}>{ch.unit}</span>}
    </div>
  )
}

// ── EyeDropper — live multi-monitor colour picker ─────────────────────────────
//
// Works on all connected monitors. While the OS eyedropper cursor is active,
// a desktopCapturer video stream is polled at ~30 fps so the LC plane and hue
// strip update in real time to show where the hovered pixel sits in OKLCH space.
// The EyeDropper API handles click detection; the video stream handles preview.
//
function EyeDropperBtn({ onPick, onPreview }) {
  const [isPicking, setIsPicking] = useState(false)
  const [liveHex, setLiveHex]     = useState(null)

  if (!eyeDropperSupported()) return null

  async function startPick() {
    setLiveHex(null)
    const hex = await pickScreenColor({
      onState: active => { setIsPicking(active); if (!active) setLiveHex(null) },
      onPreview: h => { setLiveHex(h); onPreview?.(h) },
    })
    if (hex) onPick(hex)
  }

  const btnBg    = isPicking && liveHex ? liveHex : isPicking ? T.accentSoft : T.control
  const btnBdr   = isPicking ? T.accent : T.line
  const btnColor = isPicking ? T.accentText : T.muted

  return (
    <button
      onClick={startPick}
      disabled={isPicking}
      title={isPicking ? 'Click any pixel on screen…' : 'Pick colour from screen (all monitors)'}
      className="cp-icon-btn"
      style={{
        width: 30, height: 30, flexShrink: 0, position: 'relative', overflow: 'hidden',
        background: btnBg, borderColor: btnBdr, color: btnColor,
        cursor: isPicking ? 'default' : 'pointer',
        transition: 'background 0.05s',
      }}
    >
      {isPicking && liveHex ? (
        <div style={{ position: 'absolute', inset: 0, background: liveHex, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.85)', boxShadow: '0 0 0 1px rgba(0,0,0,0.4)' }} />
        </div>
      ) : isPicking ? (
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, opacity: 0.8 }} />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.41-1.42-1.42 1.42 1.41 1.41-6.6 6.6A2 2 0 0 0 5 16v3h3a2 2 0 0 0 1.42-.59l6.6-6.6 1.41 1.42 1.42-1.42-1.42-1.41 3.12-3.12a1 1 0 0 0 0-1.65z"/>
        </svg>
      )}
    </button>
  )
}
