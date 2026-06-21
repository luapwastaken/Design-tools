import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { readAsText } from '../../lib/file.js'
import { markDirty, markSaved } from '../../lib/unsavedChanges.js'
import Icon from '../../components/Icon.jsx'
import {
  mkRng, parseSvg, C, Section, CtrlRow, SliderRow, HexInput, Toggle,
  ColorRow, btn, Segmented, ResizeHandle,
} from './ui.jsx'

const S1 = {
  name: 'Star 1 — geometric',
  content: '<polygon points="179.96 165.75 280.54 140.27 179.96 114.79 187.96 92.58 165.75 100.59 140.27 0 114.79 100.59 92.58 92.58 100.59 114.79 0 140.27 100.59 165.75 92.58 187.96 114.79 179.96 140.27 280.54 165.75 179.96 187.96 187.96 179.96 165.75"/>',
  vbW: 280.54, vbH: 280.54,
}
const S2 = {
  name: 'Star 2 — blobby',
  content: '<path d="M172.11,216.11c-69.47,73.47-79.54,70.27-102.87-27.56-91.19-43.27-91.53-53.88-5.57-106.25,13.23-100.34,22.33-103.76,99.37-38.21,99.23-17.99,105.92-11.44,67.03,82.72,47.97,88.27,43.02,97.49-57.96,89.3Z"/>',
  vbW: 259.49, vbH: 267.09,
}

function buildSvg({ sA, sB, mode, cols, rows, hGap, vGap, szMn, szMx, rotOn, rotFixed, rotMn, rotMx,
  seamless, bgCol, fColA, fColB, paletteOn, palette, jitter, offsetOn, offsetAmt, offsetAxis, seed }) {
  const rng = mkRng(seed)
  const sfB = sB || sA

  const scA_base = szMx / Math.max(sA.vbW, sA.vbH)
  const cW = sA.vbW * scA_base
  const cH = sA.vbH * scA_base
  const tW = Math.max(2, cols * cW + (cols - 1) * hGap)
  const tH = Math.max(2, rows * cH + (rows - 1) * vGap)
  const jPx = jitter * Math.min(cW + hGap, cH + vGap) * 0.45

  let elems = ''
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rv_rot = rng(), rv_shape = rng(), rv_sz = rng(), rv_jx = rng(), rv_jy = rng(), rv_col = rng()

      let cx = c * (cW + hGap) + cW / 2
      let cy = r * (cH + vGap) + cH / 2

      if (offsetOn) {
        if (offsetAxis === 'row' && r % 2 === 1) cx += offsetAmt * (cW + hGap)
        else if (offsetAxis === 'col' && c % 2 === 1) cy += offsetAmt * (cH + vGap)
      }

      cx += (rv_jx - 0.5) * 2 * jPx
      cy += (rv_jy - 0.5) * 2 * jPx

      const itemSz = szMn + rv_sz * (szMx - szMn)
      const scA_item = itemSz / Math.max(sA.vbW, sA.vbH)
      const scB_item = itemSz / Math.max(sfB.vbW, sfB.vbH)
      const rot = rotOn ? rotMn + rv_rot * (rotMx - rotMn) : rotFixed

      let sh, sc, isA
      if      (mode === 'A')     { sh = sA;  sc = scA_item; isA = true }
      else if (mode === 'B')     { sh = sfB; sc = scB_item; isA = false }
      else if (mode === 'check') { const a = (r+c)%2===0; sh = a?sA:sfB; sc = a?scA_item:scB_item; isA = a }
      else                       { const a = rv_shape > 0.5; sh = a?sA:sfB; sc = a?scA_item:scB_item; isA = a }

      const fill = paletteOn && palette.length > 0
        ? palette[Math.floor(rv_col * palette.length)]
        : (isA ? fColA : fColB)

      const el = (dx = 0, dy = 0) => {
        const tx = (cx+dx).toFixed(2), ty = (cy+dy).toFixed(2)
        const ox = (-sh.vbW/2).toFixed(2), oy = (-sh.vbH/2).toFixed(2)
        return `<g transform="translate(${tx},${ty}) rotate(${rot.toFixed(1)}) scale(${sc.toFixed(5)}) translate(${ox},${oy})" fill="${fill}">${sh.content}</g>`
      }

      elems += el()
      if (seamless) {
        const d = Math.hypot(sh.vbW, sh.vbH) * sc / 2 + 2
        const wx = cx < d ? tW : (cx > tW - d ? -tW : 0)
        const wy = cy < d ? tH : (cy > tH - d ? -tH : 0)
        if (wx)       elems += el(wx, 0)
        if (wy)       elems += el(0, wy)
        if (wx && wy) elems += el(wx, wy)
      }
    }
  }

  const W = tW.toFixed(2), H = tH.toFixed(2)
  const clip   = seamless ? `<clipPath id="c"><rect width="${W}" height="${H}"/></clipPath>` : ''
  const bg     = bgCol    ? `<rect width="${W}" height="${H}" fill="${bgCol}"/>` : ''
  const bounds = `<rect width="${W}" height="${H}" fill="none" stroke="none"/>`
  const cpAttr = seamless ? ' clip-path="url(#c)"' : ''
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${clip}</defs>${bg}<g id="tile"${cpAttr}>${bounds}${elems}</g></svg>`
  return { svg, tW, tH }
}

function ShapeSlot({ shape, label, onUpload }) {
  const ref = useRef()
  const mini = useMemo(() =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.vbW} ${shape.vbH}"><g fill="${C.accent}">${shape.content}</g></svg>`
    )}`, [shape])

  const handleFile = useCallback(async e => {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await readAsText(f)
    const p = parseSvg(text)
    if (p) onUpload({ ...p, name: f.name.replace('.svg', '') })
    e.target.value = ''
  }, [onUpload])

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <div style={{ width: 42, height: 42, background: C.ctrl, borderRadius: 6,
        border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0 }}>
        <img src={mini} width={30} height={30} style={{ objectFit: 'contain' }} alt="" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 1 }}>Shape {label}</div>
        <div style={{ fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{shape.name}</div>
        <button onClick={() => ref.current?.click()} style={{ fontSize: 11, padding: '2px 8px',
          background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 3,
          color: C.muted, cursor: 'pointer', fontFamily: 'inherit' }}>
          Replace SVG
        </button>
        <input ref={ref} type="file" accept=".svg" style={{ display: 'none' }} onChange={handleFile} />
      </div>
    </div>
  )
}

const PM_KEY = 'designtools-patternmaker'
function pmLoad() {
  try { return JSON.parse(localStorage.getItem(PM_KEY) || '{}') } catch { return {} }
}

export default function ShapesTab({ panelW, onResizeStart, tabBar }) {
  const [sA, setSA] = useState(() => pmLoad().sA ?? S1)
  const [sB, setSB] = useState(() => pmLoad().sB ?? S2)
  const [mode, setMode] = useState(() => pmLoad().mode ?? 'check')
  const [cols, setCols] = useState(() => pmLoad().cols ?? 4)
  const [rows, setRows] = useState(() => pmLoad().rows ?? 4)
  const [linkGrid, setLinkGrid] = useState(() => pmLoad().linkGrid ?? false)
  const [hGap, setHGap] = useState(() => pmLoad().hGap ?? 12)
  const [vGap, setVGap] = useState(() => pmLoad().vGap ?? 12)
  const [linkGap, setLinkGap] = useState(() => pmLoad().linkGap ?? false)
  const [szMn, setSzMn] = useState(() => pmLoad().szMn ?? 75)
  const [szMx, setSzMx] = useState(() => pmLoad().szMx ?? 75)
  const [rotOn, setRotOn] = useState(() => pmLoad().rotOn ?? true)
  const [rotFixed, setRotFixed] = useState(() => pmLoad().rotFixed ?? 0)
  const [rotMn, setRotMn] = useState(() => pmLoad().rotMn ?? 0)
  const [rotMx, setRotMx] = useState(() => pmLoad().rotMx ?? 360)
  const [seed, setSeed] = useState(() => pmLoad().seed ?? 7331)
  const [seamless, setSeamless] = useState(() => pmLoad().seamless ?? true)
  const [bgOn, setBgOn] = useState(() => pmLoad().bgOn ?? false)
  const [bgCol, setBgCol] = useState(() => pmLoad().bgCol ?? '#f5e6c8')
  const [fColA, setFColA] = useState(() => pmLoad().fColA ?? '#e8a838')
  const [fColB, setFColB] = useState(() => pmLoad().fColB ?? '#e8a838')
  const [paletteOn, setPaletteOn] = useState(() => pmLoad().paletteOn ?? false)
  const [palette, setPalette] = useState(() => pmLoad().palette ?? ['#e8a838', '#e8693b', '#c43b3b', '#8b5e2e'])
  const [jitter, setJitter] = useState(() => pmLoad().jitter ?? 0)
  const [offsetOn, setOffsetOn] = useState(() => pmLoad().offsetOn ?? false)
  const [offsetAmt, setOffsetAmt] = useState(() => pmLoad().offsetAmt ?? 50)
  const [offsetAxis, setOffsetAxis] = useState(() => pmLoad().offsetAxis ?? 'row')
  const [exportW, setExportW] = useState(() => pmLoad().exportW ?? 2000)
  const [exportH, setExportH] = useState(() => pmLoad().exportH ?? 2000)
  const [linkExport, setLinkExport] = useState(() => pmLoad().linkExport ?? true)

  const { svg, tW, tH } = useMemo(() =>
    buildSvg({ sA, sB, mode, cols, rows, hGap, vGap, szMn, szMx, rotOn, rotFixed, rotMn, rotMx,
      seamless, bgCol: bgOn ? bgCol : null, fColA, fColB, paletteOn, palette,
      jitter: jitter / 100, offsetOn, offsetAmt: offsetAmt / 100, offsetAxis, seed }),
    [sA, sB, mode, cols, rows, hGap, vGap, szMn, szMx, rotOn, rotFixed, rotMn, rotMx, seamless, bgOn, bgCol,
     fColA, fColB, paletteOn, palette, jitter, offsetOn, offsetAmt, offsetAxis, seed]
  )

  const dataUrl = useMemo(() =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg])

  const handleCols = v => { setCols(v); if (linkGrid) setRows(v) }
  const handleRows = v => { setRows(v); if (linkGrid) setCols(v) }
  const handleHGap = v => { setHGap(v); if (linkGap) setVGap(v) }
  const handleVGap = v => { setVGap(v); if (linkGap) setHGap(v) }

  const modeOpts = [['A','A'],['B','B'],['check','Checker'],['rand','Random']]

  // Randomize the layout/geometry within sane ranges — leaves the user's shapes,
  // colors and palette untouched so it explores composition, not brand.
  const surpriseMe = () => {
    const rnd = (a, b) => a + Math.random() * (b - a)
    const rndInt = (a, b) => Math.floor(rnd(a, b + 1))
    setMode(modeOpts[rndInt(0, modeOpts.length - 1)][0])
    const c = rndInt(2, 8), rw = rndInt(2, 8)
    setCols(c); setRows(linkGrid ? c : rw)
    const g = rndInt(-20, 80)
    setHGap(g); setVGap(linkGap ? g : rndInt(-20, 80))
    const base = rndInt(40, 180)
    setSzMn(base); setSzMx(base + rndInt(0, 140))
    const ro = Math.random() > 0.35
    setRotOn(ro)
    if (ro) { setRotMn(0); setRotMx(rndInt(90, 360)) } else setRotFixed(rndInt(0, 360))
    setJitter(rndInt(0, 35))
    const off = Math.random() > 0.5
    setOffsetOn(off)
    if (off) { setOffsetAxis(Math.random() > 0.5 ? 'row' : 'col'); setOffsetAmt(rndInt(20, 80)) }
    setSeed(Math.floor(Math.random() * 99999))
  }

  // Restore every setting to its factory default (matches the useState initializers).
  const resetAll = () => {
    if (!window.confirm('Reset all settings to defaults? This clears the current pattern.')) return
    setSA(S1); setSB(S2)
    setMode('check')
    setCols(4); setRows(4); setLinkGrid(false)
    setHGap(12); setVGap(12); setLinkGap(false)
    setSzMn(75); setSzMx(75)
    setRotOn(true); setRotFixed(0); setRotMn(0); setRotMx(360)
    setSeed(7331)
    setSeamless(true)
    setBgOn(false); setBgCol('#f5e6c8')
    setFColA('#e8a838'); setFColB('#e8a838')
    setPaletteOn(false); setPalette(['#e8a838', '#e8693b', '#c43b3b', '#8b5e2e'])
    setJitter(0)
    setOffsetOn(false); setOffsetAmt(50); setOffsetAxis('row')
    setExportW(2000); setExportH(2000); setLinkExport(true)
  }

  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    a.download = `tile_${cols}x${rows}_${tW.toFixed(0)}x${tH.toFixed(0)}.svg`
    a.click()
    markSaved('pattern-maker')
  }

  const downloadSwatch = () => {
    const { svg: sw, tW: sW, tH: sH } = buildSvg({
      sA, sB, mode, cols, rows, hGap, vGap, szMn, szMx, rotOn, rotFixed, rotMn, rotMx,
      seamless: false, bgCol: bgOn ? bgCol : null, fColA, fColB, paletteOn, palette,
      jitter: jitter / 100, offsetOn, offsetAmt: offsetAmt / 100, offsetAxis, seed
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([sw], { type: 'image/svg+xml' }))
    a.download = `swatch_${cols}x${rows}_${sW.toFixed(0)}x${sH.toFixed(0)}.svg`
    a.click()
    markSaved('pattern-maker')
  }

  const downloadCanvas = () => {
    const W = tW.toFixed(2), H = tH.toFixed(2)
    const b64 = btoa(unescape(encodeURIComponent(svg)))
    const out = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${exportW}" height="${exportH}" viewBox="0 0 ${exportW} ${exportH}"><defs><pattern id="t" x="0" y="0" width="${W}" height="${H}" patternUnits="userSpaceOnUse"><image xlink:href="data:image/svg+xml;base64,${b64}" width="${W}" height="${H}"/></pattern></defs><rect width="${exportW}" height="${exportH}" fill="url(#t)"/></svg>`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }))
    a.download = `canvas_${exportW}x${exportH}.svg`
    a.click()
    markSaved('pattern-maker')
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(svg).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = svg; document.body.appendChild(ta)
      ta.select(); document.execCommand('copy')
      document.body.removeChild(ta)
    })
  }

  const handleExportW = v => { setExportW(v); if (linkExport) setExportH(v) }
  const handleExportH = v => { setExportH(v); if (linkExport) setExportW(v) }

  // Auto-save (and flag unsaved edits for the warn-before-close prompt)
  const pmFirstRun = useRef(true)
  useEffect(() => {
    try {
      localStorage.setItem(PM_KEY, JSON.stringify({
        sA, sB, mode, cols, rows, linkGrid, hGap, vGap, linkGap, szMn, szMx,
        rotOn, rotFixed, rotMn, rotMx, seed, seamless, bgOn, bgCol, fColA, fColB,
        paletteOn, palette, jitter, offsetOn, offsetAmt, offsetAxis,
        exportW, exportH, linkExport,
      }))
    } catch {}
    if (pmFirstRun.current) pmFirstRun.current = false
    else markDirty('pattern-maker')
  }, [sA, sB, mode, cols, rows, linkGrid, hGap, vGap, linkGap, szMn, szMx,
      rotOn, rotFixed, rotMn, rotMx, seed, seamless, bgOn, bgCol, fColA, fColB,
      paletteOn, palette, jitter, offsetOn, offsetAmt, offsetAxis,
      exportW, exportH, linkExport])

  const [saved, setSaved] = useState(false)

  function getSessionState() {
    return { sA, sB, mode, cols, rows, linkGrid, hGap, vGap, linkGap, szMn, szMx, rotOn, rotFixed, rotMn, rotMx, seed, seamless, bgOn, bgCol, fColA, fColB, paletteOn, palette, jitter, offsetOn, offsetAmt, offsetAxis, exportW, exportH, linkExport }
  }

  function applySessionState(s) {
    if (!s) return
    if (s.sA) setSA(s.sA); if (s.sB) setSB(s.sB)
    if (s.mode) setMode(s.mode)
    if (s.cols != null) setCols(s.cols); if (s.rows != null) setRows(s.rows)
    if (s.linkGrid != null) setLinkGrid(s.linkGrid)
    if (s.hGap != null) setHGap(s.hGap); if (s.vGap != null) setVGap(s.vGap)
    if (s.linkGap != null) setLinkGap(s.linkGap)
    if (s.szMn != null) setSzMn(s.szMn); if (s.szMx != null) setSzMx(s.szMx)
    if (s.rotOn != null) setRotOn(s.rotOn); if (s.rotFixed != null) setRotFixed(s.rotFixed)
    if (s.rotMn != null) setRotMn(s.rotMn); if (s.rotMx != null) setRotMx(s.rotMx)
    if (s.seed != null) setSeed(s.seed)
    if (s.seamless != null) setSeamless(s.seamless)
    if (s.bgOn != null) setBgOn(s.bgOn); if (s.bgCol) setBgCol(s.bgCol)
    if (s.fColA) setFColA(s.fColA); if (s.fColB) setFColB(s.fColB)
    if (s.paletteOn != null) setPaletteOn(s.paletteOn)
    if (s.palette) setPalette(s.palette)
    if (s.jitter != null) setJitter(s.jitter)
    if (s.offsetOn != null) setOffsetOn(s.offsetOn)
    if (s.offsetAmt != null) setOffsetAmt(s.offsetAmt)
    if (s.offsetAxis) setOffsetAxis(s.offsetAxis)
    if (s.exportW != null) setExportW(s.exportW); if (s.exportH != null) setExportH(s.exportH)
    if (s.linkExport != null) setLinkExport(s.linkExport)
  }

  async function handleSave() {
    const data = JSON.stringify(getSessionState(), null, 2)
    if (window.electron) {
      await window.electron.saveSession('pattern-maker', data)
    } else {
      try { localStorage.setItem(PM_KEY + '-manual', data) } catch {}
    }
    markSaved('pattern-maker')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleLoad() {
    let data = null
    if (window.electron) {
      data = await window.electron.loadSession('pattern-maker')
    } else {
      data = localStorage.getItem(PM_KEY + '-manual')
    }
    if (data) { try { applySessionState(JSON.parse(data)) } catch {} }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* ── Controls ── */}
      <div style={{ width: panelW, background: C.panel, borderRight: `1px solid ${C.border}`,
        overflowY: 'auto', padding: '14px 22px 14px 14px', flexShrink: 0, position: 'relative' }}>

        {tabBar}

        <button onClick={surpriseMe} title="Randomize the layout (keeps your shapes & colors)"
          style={{ ...btn(true), width: '100%', marginBottom: 18, padding: '8px 14px' }}
          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.08)'}
          onMouseLeave={e => e.currentTarget.style.filter = ''}>
          <Icon name="casino" size={15} color="#000" />Surprise me
        </button>

        <ResizeHandle onResizeStart={onResizeStart} />

        <Section title="Shapes">
          <ShapeSlot shape={sA} label="A" onUpload={setSA} />
          <ShapeSlot shape={sB} label="B" onUpload={setSB} />
          <div style={{ marginTop: 4 }}>
            <Segmented value={mode} options={modeOpts} onChange={setMode} />
          </div>
        </Section>

        <Section title="Grid">
          <SliderRow label="Cols" min={1} max={10} value={cols} onChange={handleCols} />
          <SliderRow label="Rows" min={1} max={10} value={rows} onChange={handleRows} />
          <Toggle value={linkGrid} onChange={setLinkGrid} label="Link cols & rows" />
          <Toggle value={offsetOn} onChange={setOffsetOn} label="Half-drop offset" />
          {offsetOn && <>
            <div style={{ marginBottom: 7 }}>
              <Segmented value={offsetAxis} options={[['row','Row'],['col','Col']]} onChange={setOffsetAxis} small />
            </div>
            <SliderRow label="Amount" min={0} max={100} value={offsetAmt} onChange={setOffsetAmt} suffix="%" />
          </>}
        </Section>

        <Section title="Spacing">
          <SliderRow label="Horizontal" min={-100} max={300} value={hGap} onChange={handleHGap} suffix="px" />
          <SliderRow label="Vertical"   min={-100} max={300} value={vGap} onChange={handleVGap} suffix="px" />
          <Toggle value={linkGap} onChange={setLinkGap} label="Link H & V" />
          <SliderRow label="Jitter" min={0} max={100} value={jitter} onChange={setJitter} suffix="%" />
        </Section>

        <Section title="Item Size">
          <SliderRow label="Min" min={10} max={500} value={szMn} onChange={v => setSzMn(Math.min(v, szMx))} suffix="px" />
          <SliderRow label="Max" min={10} max={500} value={szMx} onChange={v => { setSzMx(v); if (v < szMn) setSzMn(v) }} suffix="px" />
        </Section>

        <Section title="Rotation">
          <Toggle value={rotOn} onChange={setRotOn} label="Random rotation" />
          {rotOn ? <>
            <SliderRow label="Min°" min={0} max={360} value={rotMn} onChange={v => setRotMn(Math.min(v, rotMx))} suffix="°" />
            <SliderRow label="Max°" min={0} max={360} value={rotMx} onChange={v => setRotMx(Math.max(v, rotMn))} suffix="°" />
            <button onClick={() => setSeed(Math.floor(Math.random() * 99999))} style={{ ...btn(false), width: '100%', marginTop: 2 }}>
              <Icon name="refresh" size={13} />RESEED&nbsp;<span style={{ color: C.accent }}>#{seed}</span>
            </button>
          </> :
            <SliderRow label="Angle" min={0} max={360} value={rotFixed} onChange={setRotFixed} suffix="°" />
          }
        </Section>

        <Section title="Options">
          <Toggle value={seamless} onChange={setSeamless} label="Seamless edge wrapping" />
          <Toggle value={bgOn}     onChange={setBgOn}     label="Background fill" />
          {bgOn && <ColorRow label="BG" value={bgCol} onChange={setBgCol} />}
          <ColorRow label="Color A" value={fColA} onChange={setFColA} />
          <ColorRow label="Color B" value={fColB} onChange={setFColB} />
        </Section>

        <Section title="Palette">
          <Toggle value={paletteOn} onChange={setPaletteOn} label="Use palette" />
          {paletteOn && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px', marginTop: 4 }}>
              {palette.map((col, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="color" value={col}
                    onChange={e => { const v = e.target.value; setPalette(p => p.map((c, j) => j === i ? v : c)) }}
                    style={{ width: 28, height: 22, border: `1px solid ${C.border}`, borderRadius: 3, background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                  <HexInput value={col} onChange={v => setPalette(p => p.map((c, j) => j === i ? v : c))} />
                </div>
              ))}
            </div>
          )}
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
          <button onClick={resetAll} title="Restore all settings to defaults"
            style={{ ...btn(false), width: '100%', marginBottom: 6, fontWeight: 400 }}>
            <Icon name="restart_alt" size={13} />Reset to defaults
          </button>
          <div style={{ fontSize: 10, color: C.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
            Auto-saved · Save writes to app data folder
          </div>
        </Section>

        <Section title="Export Size">
          <CtrlRow label="Width">
            <input type="number" min={1} max={20000} value={exportW}
              onChange={e => handleExportW(Math.max(1, +e.target.value || exportW))}
              style={{ flex: 1, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 3,
                color: C.text, fontSize: 11, padding: '3px 6px', fontFamily: 'inherit', outline: 'none' }} />
            <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>px</span>
          </CtrlRow>
          <CtrlRow label="Height">
            <input type="number" min={1} max={20000} value={exportH}
              onChange={e => handleExportH(Math.max(1, +e.target.value || exportH))}
              style={{ flex: 1, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 3,
                color: C.text, fontSize: 11, padding: '3px 6px', fontFamily: 'inherit', outline: 'none' }} />
            <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>px</span>
          </CtrlRow>
          <Toggle value={linkExport} onChange={setLinkExport} label="Link W & H" />
        </Section>
      </div>

      {/* ── Preview ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ height: 40, borderBottom: `1px solid ${C.border}`, flexShrink: 0,
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6 }}>
          <button onClick={download} style={btn(true)}><Icon name="download" size={14} />TILE</button>
          <button onClick={downloadSwatch} style={btn(false)} title="Clean tile (no edge-wrap) for Illustrator Object → Pattern → Make"><Icon name="image" size={14} />AI SWATCH</button>
          <button onClick={downloadCanvas} style={btn(false)}><Icon name="download" size={14} />{exportW}×{exportH}</button>
          <button onClick={copyToClipboard} style={btn(false)}><Icon name="content_copy" size={14} />COPY SVG</button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 4px', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: C.muted }}>
            tile <span style={{ color: C.text }}>{tW.toFixed(0)}×{tH.toFixed(0)}px</span>
            &nbsp;·&nbsp;grid <span style={{ color: C.text }}>{cols}×{rows}</span>
            &nbsp;·&nbsp;<span style={{ color: C.text }}>{cols*rows}</span> items
          </span>
        </div>

        <div style={{ flex: 1, overflow: 'hidden',
          backgroundImage: `url("${dataUrl}"), repeating-conic-gradient(#1d1d23 0% 25%, #131317 0% 50%)`,
          backgroundSize: `${tW}px ${tH}px, 20px 20px`,
          backgroundRepeat: 'repeat' }} />

        <div style={{ height: 28, borderTop: `1px solid ${C.border}`, flexShrink: 0,
          display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 10, color: C.dim }}>
          AI swatch: open in Illustrator → Select All → Object → Pattern → Make · tile {tW.toFixed(0)}×{tH.toFixed(0)}px
        </div>
      </div>
    </div>
  )
}
