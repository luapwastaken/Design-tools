import { useState, useMemo, useRef, useEffect } from 'react'
import { markDirty, markSaved } from '../../lib/unsavedChanges.js'
import { readAsDataUrl } from '../../lib/file.js'
import Icon from '../../components/Icon.jsx'
import {
  C, Section, CtrlRow, SliderRow, Toggle, ColorRow, btn, Segmented, ResizeHandle,
} from './ui.jsx'
import { buildMeteorite, buildDuotone, anglesFor, PRESETS, PANELS } from './meteorite.js'

const MT_KEY = 'designtools-meteorite'
function mtLoad() {
  try { return JSON.parse(localStorage.getItem(MT_KEY) || '{}') } catch { return {} }
}

const DEFAULTS = {
  source: 'generated', style: 'lamellae',
  count: 2, baseAngle: 30,
  spacing: 40, spacingJit: 40,
  bandMin: 6, bandMax: 16,
  segMin: 60, segMax: 200,
  gapMin: 20, gapMax: 90,
  rimOn: false, rimW: 2,
  matrixCol: '#101015', bandCol: '#c9c4b8', rimCol: '#f4efe6',
  vOn: false, vReach: 100, vSoft: 25, vAnchor: 'bottom',
  hOn: false, hReach: 100, hSoft: 25, hAnchor: 'left',
  opacityVar: false,
  deboss: false, debossDepth: 2,
  duoContrast: 100,
  mode: 'tile', widthMm: 120, heightMm: 120, dpi: 300,
  tileW: 800, tileH: 800,
  seed: 4242,
}

export default function MeteoriteTab({ panelW, onResizeStart, tabBar }) {
  const init = (k) => mtLoad()[k] ?? DEFAULTS[k]
  const [source, setSource] = useState(() => init('source'))
  const [style, setStyle] = useState(() => init('style'))
  const [count, setCount] = useState(() => init('count'))
  const [baseAngle, setBaseAngle] = useState(() => init('baseAngle'))
  const [spacing, setSpacing] = useState(() => init('spacing'))
  const [spacingJit, setSpacingJit] = useState(() => init('spacingJit'))
  const [bandMin, setBandMin] = useState(() => init('bandMin'))
  const [bandMax, setBandMax] = useState(() => init('bandMax'))
  const [segMin, setSegMin] = useState(() => init('segMin'))
  const [segMax, setSegMax] = useState(() => init('segMax'))
  const [gapMin, setGapMin] = useState(() => init('gapMin'))
  const [gapMax, setGapMax] = useState(() => init('gapMax'))
  const [rimOn, setRimOn] = useState(() => init('rimOn'))
  const [rimW, setRimW] = useState(() => init('rimW'))
  const [matrixCol, setMatrixCol] = useState(() => init('matrixCol'))
  const [bandCol, setBandCol] = useState(() => init('bandCol'))
  const [rimCol, setRimCol] = useState(() => init('rimCol'))
  const [vOn, setVOn] = useState(() => init('vOn'))
  const [vReach, setVReach] = useState(() => init('vReach'))
  const [vSoft, setVSoft] = useState(() => init('vSoft'))
  const [vAnchor, setVAnchor] = useState(() => init('vAnchor'))
  const [hOn, setHOn] = useState(() => init('hOn'))
  const [hReach, setHReach] = useState(() => init('hReach'))
  const [hSoft, setHSoft] = useState(() => init('hSoft'))
  const [hAnchor, setHAnchor] = useState(() => init('hAnchor'))
  const [opacityVar, setOpacityVar] = useState(() => init('opacityVar'))
  const [deboss, setDeboss] = useState(() => init('deboss'))
  const [debossDepth, setDebossDepth] = useState(() => init('debossDepth'))
  const [duoContrast, setDuoContrast] = useState(() => init('duoContrast'))
  // Image (real-etch duotone) source — kept in state only; the data URL is too
  // large to persist to localStorage, so it is re-uploaded each session.
  const [imageHref, setImageHref] = useState(null)
  const [imageName, setImageName] = useState('')
  const fileRef = useRef(null)
  const [mode, setMode] = useState(() => init('mode'))
  const [widthMm, setWidthMm] = useState(() => init('widthMm'))
  const [heightMm, setHeightMm] = useState(() => init('heightMm'))
  const [dpi, setDpi] = useState(() => init('dpi'))
  const [tileW, setTileW] = useState(() => init('tileW'))
  const [tileH, setTileH] = useState(() => init('tileH'))
  const [seed, setSeed] = useState(() => init('seed'))

  const engineParams = useMemo(() => ({
    seed, mode, style,
    angles: anglesFor(count, baseAngle),
    spacing, spacingJit: spacingJit / 100,
    bandMin, bandMax: Math.max(bandMin, bandMax),
    segMin, segMax: Math.max(segMin, segMax),
    gapMin, gapMax: Math.max(gapMin, gapMax),
    rimOn, rimW,
    matrixCol, bandCol, rimCol,
    vOn, vReach: vReach / 100, vSoft: vSoft / 100, vAnchor,
    hOn, hReach: hReach / 100, hSoft: hSoft / 100, hAnchor,
    opacityVar, deboss, debossDepth,
    seamless: true,
    widthMm, heightMm, dpi, tileW, tileH,
  }), [seed, mode, style, count, baseAngle, spacing, spacingJit, bandMin, bandMax, segMin, segMax,
       gapMin, gapMax, rimOn, rimW, matrixCol, bandCol, rimCol, vOn, vReach, vSoft, vAnchor,
       hOn, hReach, hSoft, hAnchor, opacityVar, deboss, debossDepth, widthMm, heightMm, dpi, tileW, tileH])

  const duoParams = useMemo(() => ({
    href: imageHref, matrixCol, bandCol, contrast: duoContrast / 100,
    mode, widthMm, heightMm, dpi, tileW, tileH,
  }), [imageHref, matrixCol, bandCol, duoContrast, mode, widthMm, heightMm, dpi, tileW, tileH])

  const isImage = source === 'image'
  const { svg, W, H } = useMemo(
    () => isImage ? buildDuotone(duoParams) : buildMeteorite(engineParams),
    [isImage, duoParams, engineParams])
  const dataUrl = useMemo(() =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg])

  const applyPreset = (name) => {
    const p = PRESETS[name]
    if (!p) return
    setSource('generated')
    setCount(p.angles2); setBaseAngle(p.baseAngle)
    setSpacing(p.spacing); setSpacingJit(Math.round(p.spacingJit * 100))
    setBandMin(p.bandMin); setBandMax(p.bandMax)
    setSegMin(p.segMin); setSegMax(p.segMax)
    setGapMin(p.gapMin); setGapMax(p.gapMax)
    setRimOn(p.rimOn); if (p.rimW != null) setRimW(p.rimW)
    if (p.matrixCol) setMatrixCol(p.matrixCol)
    if (p.bandCol) setBandCol(p.bandCol)
  }

  const loadPanel = (mm, hh) => { setMode('fit'); setWidthMm(mm); setHeightMm(hh) }

  const handleImage = async e => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = await readAsDataUrl(f)
    setImageHref(url); setImageName(f.name); setSource('image')
    e.target.value = ''
  }

  // Setter map shared by Reset and Load.
  const SETTERS = {
    source: setSource, style: setStyle,
    count: setCount, baseAngle: setBaseAngle, spacing: setSpacing, spacingJit: setSpacingJit,
    bandMin: setBandMin, bandMax: setBandMax, segMin: setSegMin, segMax: setSegMax,
    gapMin: setGapMin, gapMax: setGapMax, rimOn: setRimOn, rimW: setRimW,
    matrixCol: setMatrixCol, bandCol: setBandCol, rimCol: setRimCol,
    vOn: setVOn, vReach: setVReach, vSoft: setVSoft, vAnchor: setVAnchor,
    hOn: setHOn, hReach: setHReach, hSoft: setHSoft, hAnchor: setHAnchor,
    opacityVar: setOpacityVar, deboss: setDeboss, debossDepth: setDebossDepth,
    duoContrast: setDuoContrast,
    mode: setMode, widthMm: setWidthMm, heightMm: setHeightMm,
    dpi: setDpi, tileW: setTileW, tileH: setTileH, seed: setSeed,
  }

  const resetAll = () => {
    if (!window.confirm('Reset Meteorite settings to defaults? This clears the current pattern.')) return
    for (const [k, v] of Object.entries(DEFAULTS)) SETTERS[k](v)
  }

  const dl = (text, name) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
    a.download = name
    a.click()
    markSaved('meteorite')
  }

  const download = () => dl(svg, `meteorite_${W}x${H}.svg`)
  const downloadSwatch = () => {
    if (isImage) { dl(svg, `meteorite_duotone_${W}x${H}.svg`); return }
    const { svg: sw } = buildMeteorite({ ...engineParams, seamless: false })
    dl(sw, `meteorite_swatch_${W}x${H}.svg`)
  }
  const copyToClipboard = () => {
    navigator.clipboard.writeText(svg).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = svg; document.body.appendChild(ta)
      ta.select(); document.execCommand('copy')
      document.body.removeChild(ta)
    })
  }

  // All persisted (and session-saved) fields. The uploaded image is intentionally
  // excluded — too large for localStorage and re-uploaded each session.
  const fields = {
    source, style, count, baseAngle, spacing, spacingJit, bandMin, bandMax, segMin, segMax,
    gapMin, gapMax, rimOn, rimW, matrixCol, bandCol, rimCol,
    vOn, vReach, vSoft, vAnchor, hOn, hReach, hSoft, hAnchor, opacityVar,
    deboss, debossDepth, duoContrast,
    mode, widthMm, heightMm, dpi, tileW, tileH, seed,
  }

  // Auto-save + dirty tracking
  const firstRun = useRef(true)
  useEffect(() => {
    try { localStorage.setItem(MT_KEY, JSON.stringify(fields)) } catch {}
    if (firstRun.current) firstRun.current = false
    else markDirty('meteorite')
  }, Object.values(fields))

  const [saved, setSaved] = useState(false)
  const sessionState = () => fields
  const applySession = (s) => {
    if (!s) return
    for (const [k, fn] of Object.entries(SETTERS)) if (s[k] != null) fn(s[k])
  }
  async function handleSave() {
    const data = JSON.stringify(sessionState(), null, 2)
    if (window.electron) await window.electron.saveSession('meteorite', data)
    else { try { localStorage.setItem(MT_KEY + '-manual', data) } catch {} }
    markSaved('meteorite')
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }
  async function handleLoad() {
    let data = null
    if (window.electron) data = await window.electron.loadSession('meteorite')
    else data = localStorage.getItem(MT_KEY + '-manual')
    if (data) { try { applySession(JSON.parse(data)) } catch {} }
  }

  const presetNames = Object.keys(PRESETS)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* ── Controls ── */}
      <div style={{ width: panelW, background: C.panel, borderRight: `1px solid ${C.border}`,
        overflowY: 'auto', padding: '14px 22px 14px 14px', flexShrink: 0, position: 'relative' }}>

        {tabBar}
        <ResizeHandle onResizeStart={onResizeStart} />

        <Section title="Source">
          <Segmented value={source} options={[['generated','Generated'],['image','Real-etch image']]} onChange={setSource} />
        </Section>

        {isImage && (
          <Section title="Duotone">
            <button onClick={() => fileRef.current?.click()} style={{ ...btn(false), width: '100%', marginBottom: 6 }}>
              <Icon name="upload" size={13} />{imageHref ? 'Replace image' : 'Upload meteorite scan'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImage} />
            {imageName && <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{imageName}</div>}
            <SliderRow label="Contrast" min={20} max={300} value={duoContrast} onChange={setDuoContrast} suffix="%" />
            <div style={{ fontSize: 10, color: C.dim }}>Maps the photo's luminance between the two ink colours below.</div>
          </Section>
        )}

        {!isImage && <>
        <Section title="Presets">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
            {presetNames.map(n => (
              <button key={n} onClick={() => applyPreset(n)} style={{ ...btn(false), padding: '5px 0', fontWeight: 400,
                ...(n === 'Monolith' ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>{n}</button>
            ))}
          </div>
          <button onClick={() => setSeed(Math.floor(Math.random() * 99999))} style={{ ...btn(false), width: '100%' }}>
            <Icon name="refresh" size={13} />RESEED&nbsp;<span style={{ color: C.accent }}>#{seed}</span>
          </button>
        </Section>

        <Section title="Structure">
          <div style={{ marginBottom: 8 }}>
            <Segmented value={style} options={[['lamellae','Lamellae'],['hairline','Hairline']]} onChange={setStyle} />
          </div>
          <SliderRow label="Families" min={2} max={4} value={count} onChange={setCount} />
          <SliderRow label="Angle" min={0} max={180} value={baseAngle} onChange={setBaseAngle} suffix="°" />
          <SliderRow label="Spacing" min={8} max={160} value={spacing} onChange={setSpacing} suffix="px" />
          <SliderRow label="Spc jit" min={0} max={100} value={spacingJit} onChange={setSpacingJit} suffix="%" />
          <SliderRow label={style === 'hairline' ? 'Line w' : 'Band min'} min={1} max={60} value={bandMin} onChange={v => setBandMin(Math.min(v, bandMax))} suffix="px" />
          {style !== 'hairline' && <>
            <SliderRow label="Band max" min={1} max={60} value={bandMax} onChange={v => { setBandMax(v); if (v < bandMin) setBandMin(v) }} suffix="px" />
            <SliderRow label="Seg min" min={10} max={500} value={segMin} onChange={v => setSegMin(Math.min(v, segMax))} suffix="px" />
            <SliderRow label="Seg max" min={10} max={500} value={segMax} onChange={v => { setSegMax(v); if (v < segMin) setSegMin(v) }} suffix="px" />
            <SliderRow label="Gap min" min={0} max={300} value={gapMin} onChange={v => setGapMin(Math.min(v, gapMax))} suffix="px" />
            <SliderRow label="Gap max" min={0} max={300} value={gapMax} onChange={v => { setGapMax(v); if (v < gapMin) setGapMin(v) }} suffix="px" />
          </>}
        </Section>

        <Section title="Reach — vertical">
          <Toggle value={vOn} onChange={setVOn} label="Limit vertical reach" />
          {vOn && <>
            <div style={{ marginBottom: 7 }}>
              <Segmented value={vAnchor} options={[['bottom','From bottom'],['top','From top']]} onChange={setVAnchor} small />
            </div>
            <SliderRow label="Reach" min={0} max={100} value={vReach} onChange={setVReach} suffix="%" />
            <SliderRow label="Softness" min={0} max={100} value={vSoft} onChange={setVSoft} suffix="%" />
          </>}
        </Section>

        <Section title="Reach — horizontal">
          <Toggle value={hOn} onChange={setHOn} label="Limit horizontal reach" />
          {hOn && <>
            <div style={{ marginBottom: 7 }}>
              <Segmented value={hAnchor} options={[['left','From left'],['right','From right']]} onChange={setHAnchor} small />
            </div>
            <SliderRow label="Reach" min={0} max={100} value={hReach} onChange={setHReach} suffix="%" />
            <SliderRow label="Softness" min={0} max={100} value={hSoft} onChange={setHSoft} suffix="%" />
          </>}
        </Section>

        <Section title="Colors">
          <ColorRow label="Matrix" value={matrixCol} onChange={setMatrixCol} />
          <ColorRow label="Band" value={bandCol} onChange={setBandCol} />
          <Toggle value={rimOn} onChange={setRimOn} label="Bright rim (taenite edge)" />
          {rimOn && <>
            <ColorRow label="Rim" value={rimCol} onChange={setRimCol} />
            <SliderRow label="Rim width" min={1} max={12} value={rimW} onChange={setRimW} suffix="px" />
          </>}
        </Section>

        <Section title="Appearance">
          <Toggle value={opacityVar} onChange={setOpacityVar} label="Opacity variation" />
          <Toggle value={deboss} onChange={setDeboss} label="Deboss preview (bevel)" />
          {deboss && <>
            <SliderRow label="Depth" min={1} max={8} value={debossDepth} onChange={setDebossDepth} step={0.5} suffix="px" />
            <div style={{ fontSize: 10, color: C.dim }}>Tip: set Band = Matrix for a true blind tone-on-tone emboss.</div>
          </>}
        </Section>
        </>}

        <Section title="Output">
          <div style={{ marginBottom: 8 }}>
            <Segmented value={mode} options={[['fit','Fit to size'],['tile','Seamless tile']]} onChange={setMode} />
          </div>
          {mode === 'fit' ? <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
              {PANELS.map(([label, mm, hh]) => (
                <button key={label} onClick={() => loadPanel(mm, hh)} title={`${mm}×${hh} mm`}
                  style={{ ...btn(false), padding: '5px 2px', fontWeight: 400, fontSize: 10,
                    ...(widthMm === mm && heightMm === hh ? { border: `1px solid ${C.accent}`, color: C.accent } : {}) }}>{label}</button>
              ))}
            </div>
            <SliderRow label="Width" min={10} max={1000} value={widthMm} onChange={setWidthMm} suffix="mm" />
            <SliderRow label="Height" min={10} max={1000} value={heightMm} onChange={setHeightMm} suffix="mm" />
            <SliderRow label="DPI" min={72} max={1200} value={dpi} onChange={setDpi} />
          </> : <>
            <SliderRow label="Width" min={100} max={4000} value={tileW} onChange={setTileW} suffix="px" />
            <SliderRow label="Height" min={100} max={4000} value={tileH} onChange={setTileH} suffix="px" />
          </>}
        </Section>

        <Section title="Session">
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={handleSave} style={{ ...btn(true), flex: 1, transition: 'opacity 0.15s' }}>
              {saved ? <><Icon name="check_circle" size={13} />Saved</> : <><Icon name="save" size={13} />Save</>}
            </button>
            <button onClick={handleLoad} style={{ ...btn(false), flex: 1 }}>
              <Icon name="folder" size={13} />Load
            </button>
          </div>
          <button onClick={resetAll} title="Restore Meteorite settings to defaults"
            style={{ ...btn(false), width: '100%', marginBottom: 6, fontWeight: 400 }}>
            <Icon name="restart_alt" size={13} />Reset to defaults
          </button>
          <div style={{ fontSize: 10, color: C.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
            Auto-saved · Save writes to app data folder
          </div>
        </Section>
      </div>

      {/* ── Preview ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ height: 40, borderBottom: `1px solid ${C.border}`, flexShrink: 0,
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6 }}>
          <button onClick={download} style={btn(true)}><Icon name="download" size={14} />{mode === 'fit' ? 'PANEL' : 'TILE'}</button>
          <button onClick={downloadSwatch} style={btn(false)} title="Clean tile (no edge-wrap) for Illustrator Object → Pattern → Make"><Icon name="image" size={14} />AI SWATCH</button>
          <button onClick={copyToClipboard} style={btn(false)}><Icon name="content_copy" size={14} />COPY SVG</button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 4px', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: C.muted }}>
            {mode === 'fit'
              ? <>{widthMm}×{heightMm}mm @ {dpi}dpi · <span style={{ color: C.text }}>{W}×{H}px</span></>
              : <>tile <span style={{ color: C.text }}>{W}×{H}px</span></>}
          </span>
        </div>

        {mode === 'fit'
          ? <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24, background: 'repeating-conic-gradient(#1d1d23 0% 25%, #131317 0% 50%) 0 / 20px 20px' }}>
              <img src={dataUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }} />
            </div>
          : <div style={{ flex: 1, overflow: 'hidden',
              backgroundImage: `url("${dataUrl}"), repeating-conic-gradient(#1d1d23 0% 25%, #131317 0% 50%)`,
              backgroundSize: `${W}px ${H}px, 20px 20px`,
              backgroundRepeat: 'repeat' }} />}

        <div style={{ height: 28, borderTop: `1px solid ${C.border}`, flexShrink: 0,
          display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 10, color: C.dim }}>
          {mode === 'fit'
            ? 'Fit mode: one composition sized to the exact panel · CMYK conversion happens in the Color Palette tool'
            : 'AI swatch: open in Illustrator → Select All → Object → Pattern → Make'}
        </div>
      </div>
    </div>
  )
}
