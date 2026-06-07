import { useState, useRef, useEffect } from 'react'
import { C, btn, Section, Row, SliderRow, HexInput, Toggle, SegmentedControl } from './ui.jsx'
import { VARIATIONS, BOTH_LAYOUTS, computeLayout } from './layout.js'
import { LockupSvg, Handle } from './LockupSvg.jsx'
import { FileSlot } from './FileSlot.jsx'
import { VariationCard } from './VariationCard.jsx'
import { TreatmentPicker } from './Treatments.jsx'
import { ClearspaceSection, MinSizeStrip } from './Clearspace.jsx'
import { BackgroundRow } from './BackgroundRow.jsx'
import { FaviconView } from './FaviconView.jsx'
import { isSvgLikelyBlack, parseSvgText, buildTreatmentFilterStr } from '../../lib/svg.js'
import { processFile } from '../../lib/file.js'
import { markDirty, markSaved } from '../../lib/unsavedChanges.js'

// ── Session storage ───────────────────────────────────────────────────────────
const LM_KEY = 'designtools-logomaker'
function lmLoad() {
  try { return JSON.parse(localStorage.getItem(LM_KEY) || '{}') } catch { return {} }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LogoMaker() {
  const [step, setStep] = useState(1)
  const [activeVar, setActiveVar] = useState(() => lmLoad().activeVar ?? 'horizontal')

  const [iconFile, setIconFile] = useState(() => lmLoad().iconFile ?? null)
  const [wordmarkFile, setWordmarkFile] = useState(() => lmLoad().wordmarkFile ?? null)

  const [bgColor, setBgColor] = useState(() => lmLoad().bgColor ?? '#000000')
  const [guideColor, setGuideColor] = useState(() => lmLoad().guideColor ?? '#444444')
  const [showGuides, setShowGuides] = useState(() => lmLoad().showGuides ?? true)
  const [showSafeZone, setShowSafeZone] = useState(() => lmLoad().showSafeZone ?? false)

  const [iconColorOn, setIconColorOn] = useState(() => lmLoad().iconColorOn ?? false)
  const [iconColor, setIconColor] = useState(() => lmLoad().iconColor ?? '#ffffff')
  const [wordmarkColorOn, setWordmarkColorOn] = useState(() => lmLoad().wordmarkColorOn ?? false)
  const [wordmarkColor, setWordmarkColor] = useState(() => lmLoad().wordmarkColor ?? '#ffffff')

  const [lockAnchor, setLockAnchor] = useState(() => lmLoad().lockAnchor ?? 'wordmark')
  const [iconScale, setIconScale] = useState(() => lmLoad().iconScale ?? 0.85)
  const [gapRatio, setGapRatio] = useState(() => lmLoad().gapRatio ?? 0.25)
  const [alignment, setAlignment] = useState(() => lmLoad().alignment ?? 'center')

  const [panelW, setPanelW] = useState(() => lmLoad().panelW ?? 268)
  const [exportW, setExportW] = useState(() => lmLoad().exportW ?? 2048)
  const [pngIncludeGuides, setPngIncludeGuides] = useState(() => lmLoad().pngIncludeGuides ?? false)

  // ── New state ───────────────────────────────────────────────────────────────
  const [activeTreatment, setActiveTreatment] = useState(() => lmLoad().activeTreatment ?? 'original')
  const [treatmentSpotColor, setTreatmentSpotColor] = useState(() => lmLoad().treatmentSpotColor ?? '#e63946')
  const [treatmentDuotoneDark, setTreatmentDuotoneDark] = useState(() => lmLoad().treatmentDuotoneDark ?? '#1d3557')
  const [treatmentDuotoneLight, setTreatmentDuotoneLight] = useState(() => lmLoad().treatmentDuotoneLight ?? '#a8dadc')
  const [showClearspace, setShowClearspace] = useState(() => lmLoad().showClearspace ?? false)
  const [clearspaceN, setClearspaceN] = useState(() => lmLoad().clearspaceN ?? 0.5)
  const [showMinSizes, setShowMinSizes] = useState(() => lmLoad().showMinSizes ?? false)
  const [showBgContext, setShowBgContext] = useState(() => lmLoad().showBgContext ?? false)
  const [brandColor, setBrandColor] = useState(() => lmLoad().brandColor ?? '#3366ff')
  const [exportEnabled, setExportEnabled] = useState(() => lmLoad().exportEnabled ?? {})

  const [saved, setSaved] = useState(false)
  const [copyState, setCopyState] = useState(null) // null | 'svg' | 'png'
  const [exportAllSvg, setExportAllSvg] = useState(true)
  const [exportAllPng, setExportAllPng] = useState(true)
  const [exportingAll, setExportingAll] = useState(false)
  const [exportAllDone, setExportAllDone] = useState(false)
  const refineSvgRef = useRef(null)

  // ── Undo / redo ──────────────────────────────────────────────────────────────
  const historyRef        = useRef([])   // stack of doc snapshots
  const historyIdxRef     = useRef(-1)   // pointer into the stack
  const isApplyingRef     = useRef(false) // prevents feedback push while restoring
  const histDebounceRef   = useRef(null)

  // Latest applyDocState in a ref so the keydown handler (empty deps) always
  // calls the current version without needing to re-register.
  const applyDocStateRef = useRef(null)
  applyDocStateRef.current = function applyDocState(s) {
    isApplyingRef.current = true
    setActiveVar(s.activeVar)
    setIconFile(s.iconFile)
    setWordmarkFile(s.wordmarkFile)
    setBgColor(s.bgColor)
    setGuideColor(s.guideColor)
    setShowGuides(s.showGuides)
    setShowSafeZone(s.showSafeZone)
    setIconColorOn(s.iconColorOn)
    setIconColor(s.iconColor)
    setWordmarkColorOn(s.wordmarkColorOn)
    setWordmarkColor(s.wordmarkColor)
    setLockAnchor(s.lockAnchor)
    setIconScale(s.iconScale)
    setGapRatio(s.gapRatio)
    setAlignment(s.alignment)
    setActiveTreatment(s.activeTreatment)
    setTreatmentSpotColor(s.treatmentSpotColor)
    setTreatmentDuotoneDark(s.treatmentDuotoneDark)
    setTreatmentDuotoneLight(s.treatmentDuotoneLight)
    setShowClearspace(s.showClearspace)
    setClearspaceN(s.clearspaceN)
    setShowMinSizes(s.showMinSizes)
    setShowBgContext(s.showBgContext)
    setBrandColor(s.brandColor)
    setExportEnabled(s.exportEnabled)
  }

  // Watch all undoable state; debounce snapshot pushes by 400 ms so slider
  // drags don't flood the stack — the snapshot is captured immediately but
  // committed after the user pauses.
  useEffect(() => {
    if (isApplyingRef.current) {
      isApplyingRef.current = false  // clear flag after the effect fires post-restore
      return
    }
    const snap = {
      activeVar, iconFile, wordmarkFile,
      bgColor, guideColor, showGuides, showSafeZone,
      iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
      lockAnchor, iconScale, gapRatio, alignment,
      activeTreatment, treatmentSpotColor, treatmentDuotoneDark, treatmentDuotoneLight,
      showClearspace, clearspaceN, showMinSizes, showBgContext, brandColor, exportEnabled,
    }
    clearTimeout(histDebounceRef.current)
    histDebounceRef.current = setTimeout(() => {
      const history = historyRef.current
      const idx     = historyIdxRef.current
      // Truncate any forward history then push
      const next = history.slice(0, idx + 1)
      next.push(snap)
      if (next.length > 100) next.shift()
      historyRef.current    = next
      historyIdxRef.current = next.length - 1
    }, 400)
  }, [activeVar, iconFile, wordmarkFile,
      bgColor, guideColor, showGuides, showSafeZone,
      iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
      lockAnchor, iconScale, gapRatio, alignment,
      activeTreatment, treatmentSpotColor, treatmentDuotoneDark, treatmentDuotoneLight,
      showClearspace, clearspaceN, showMinSizes, showBgContext, brandColor, exportEnabled])

  // Ctrl+Z / Ctrl+Y keyboard handler
  useEffect(() => {
    function onKey(e) {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const idx = historyIdxRef.current
        if (idx > 0) {
          historyIdxRef.current = idx - 1
          applyDocStateRef.current(historyRef.current[historyIdxRef.current])
        }
      }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        const idx = historyIdxRef.current
        if (idx < historyRef.current.length - 1) {
          historyIdxRef.current = idx + 1
          applyDocStateRef.current(historyRef.current[historyIdxRef.current])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Clipboard paste ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function handlePaste(e) {
      const items = Array.from(e.clipboardData?.items ?? [])
      const svgItem = items.find(i => i.type === 'image/svg+xml')
      if (svgItem) {
        const f = svgItem.getAsFile()
        if (f) { const r = await processFile(f); if (r) assignToSlot(r) }
        return
      }
      const textItem = items.find(i => i.type === 'text/plain')
      if (textItem) {
        textItem.getAsString(text => {
          const t = text.trim()
          if (t.startsWith('<svg') || t.includes('<svg ')) {
            const parsed = parseSvgText(t)
            if (parsed) assignToSlot({ name: 'pasted.svg', type: 'svg', ...parsed })
          }
        })
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [iconFile, wordmarkFile])

  function assignToSlot(file) {
    const isBlack = file.type === 'svg' && isSvgLikelyBlack(file.raw)
    if (!iconFile) { setIconFile(file); if (isBlack) setIconColorOn(true) }
    else if (!wordmarkFile) { setWordmarkFile(file); if (isBlack) setWordmarkColorOn(true) }
  }

  // ── Panel resize ────────────────────────────────────────────────────────────
  function startPanelResize(e) {
    e.preventDefault()
    const startX = e.clientX, startW = panelW
    function onMove(e2) { setPanelW(Math.min(480, Math.max(200, startW + e2.clientX - startX))) }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Auto-save (and flag unsaved edits for the warn-before-close prompt) ───────
  const lmFirstRun = useRef(true)
  useEffect(() => {
    const strip = f => f ? { name: f.name, type: f.type, dataUrl: f.dataUrl, vw: f.vw, vh: f.vh, aspect: f.aspect } : null
    try {
      localStorage.setItem(LM_KEY, JSON.stringify({
        activeVar, iconFile: strip(iconFile), wordmarkFile: strip(wordmarkFile),
        bgColor, guideColor, showGuides, showSafeZone,
        iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
        lockAnchor, iconScale, gapRatio, alignment,
        panelW, exportW, pngIncludeGuides,
        activeTreatment, treatmentSpotColor, treatmentDuotoneDark, treatmentDuotoneLight,
        showClearspace, clearspaceN, showMinSizes, showBgContext, brandColor, exportEnabled,
      }))
    } catch {}
    if (lmFirstRun.current) lmFirstRun.current = false
    else markDirty('logo-maker')
  }, [activeVar, iconFile, wordmarkFile, bgColor, guideColor, showGuides, showSafeZone,
      iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
      lockAnchor, iconScale, gapRatio, alignment, panelW, exportW, pngIncludeGuides,
      activeTreatment, treatmentSpotColor, treatmentDuotoneDark, treatmentDuotoneLight,
      showClearspace, clearspaceN, showMinSizes, showBgContext, brandColor, exportEnabled])

  function getSessionState() {
    const strip = f => f ? { name: f.name, type: f.type, dataUrl: f.dataUrl, vw: f.vw, vh: f.vh, aspect: f.aspect } : null
    return {
      activeVar, iconFile: strip(iconFile), wordmarkFile: strip(wordmarkFile),
      bgColor, guideColor, showGuides, showSafeZone,
      iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
      lockAnchor, iconScale, gapRatio, alignment, panelW, exportW, pngIncludeGuides,
      activeTreatment, treatmentSpotColor, treatmentDuotoneDark, treatmentDuotoneLight,
      showClearspace, clearspaceN, showMinSizes, showBgContext, brandColor, exportEnabled,
    }
  }

  function applySessionState(s) {
    if (!s) return
    if (s.activeVar) setActiveVar(s.activeVar)
    setIconFile(s.iconFile ?? null)
    setWordmarkFile(s.wordmarkFile ?? null)
    if (s.bgColor) setBgColor(s.bgColor)
    if (s.guideColor) setGuideColor(s.guideColor)
    if (s.showGuides != null) setShowGuides(s.showGuides)
    if (s.showSafeZone != null) setShowSafeZone(s.showSafeZone)
    if (s.iconColorOn != null) setIconColorOn(s.iconColorOn)
    if (s.iconColor) setIconColor(s.iconColor)
    if (s.wordmarkColorOn != null) setWordmarkColorOn(s.wordmarkColorOn)
    if (s.wordmarkColor) setWordmarkColor(s.wordmarkColor)
    if (s.lockAnchor) setLockAnchor(s.lockAnchor)
    if (s.iconScale != null) setIconScale(s.iconScale)
    if (s.gapRatio != null) setGapRatio(s.gapRatio)
    if (s.alignment) setAlignment(s.alignment)
    if (s.panelW) setPanelW(s.panelW)
    if (s.exportW) setExportW(s.exportW)
    if (s.pngIncludeGuides != null) setPngIncludeGuides(s.pngIncludeGuides)
    if (s.activeTreatment) setActiveTreatment(s.activeTreatment)
    if (s.treatmentSpotColor) setTreatmentSpotColor(s.treatmentSpotColor)
    if (s.treatmentDuotoneDark) setTreatmentDuotoneDark(s.treatmentDuotoneDark)
    if (s.treatmentDuotoneLight) setTreatmentDuotoneLight(s.treatmentDuotoneLight)
    if (s.showClearspace != null) setShowClearspace(s.showClearspace)
    if (s.clearspaceN != null) setClearspaceN(s.clearspaceN)
    if (s.showMinSizes != null) setShowMinSizes(s.showMinSizes)
    if (s.showBgContext != null) setShowBgContext(s.showBgContext)
    if (s.brandColor) setBrandColor(s.brandColor)
    if (s.exportEnabled) setExportEnabled(s.exportEnabled)
    setStep(1)
  }

  async function handleSave() {
    const data = JSON.stringify(getSessionState(), null, 2)
    if (window.electron) {
      await window.electron.saveSession('logo-maker', data)
    } else {
      try { localStorage.setItem(LM_KEY + '-manual', data) } catch {}
    }
    markSaved('logo-maker')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleLoad() {
    let data = null
    if (window.electron) {
      data = await window.electron.loadSession('logo-maker')
    } else {
      data = localStorage.getItem(LM_KEY + '-manual')
    }
    if (data) { try { applySessionState(JSON.parse(data)) } catch {} }
  }

  // ── Drag handle logic ───────────────────────────────────────────────────────
  function startHandleDrag(e, sign) {
    e.preventDefault()
    const svgEl = refineSvgRef.current
    if (!svgEl) return
    const svgRect = svgEl.getBoundingClientRect()
    const effectiveLayout = !iconFile ? 'w' : !wordmarkFile ? 'i' : activeVariation.layout
    const lyt = computeLayout({
      layout: effectiveLayout,
      iconAspect: iconFile?.aspect ?? 1,
      wordmarkAspect: wordmarkFile?.aspect ?? 1,
      iconScale, gapRatio, alignment,
    })
    if (!lyt) return
    const pad = Math.max(lyt.totalW, lyt.totalH) * 0.38
    const vH = lyt.totalH + pad * 2
    const pxPerUnit = svgRect.height / vH
    const startY = e.clientY, startScale = iconScale

    function onMove(e2) {
      const dy = (e2.clientY - startY) * sign / pxPerUnit
      if (lockAnchor === 'wordmark') {
        setIconScale(Math.max(0.1, Math.min(5, startScale + dy)))
      } else {
        const newWordmarkH = Math.max(0.1, 1 + dy)
        setIconScale(Math.max(0.1, Math.min(5, startScale / newWordmarkH)))
      }
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Clipboard ────────────────────────────────────────────────────────────────
  async function copySvg() {
    const clone = getCleanClone(false)
    if (!clone) return
    try {
      await navigator.clipboard.writeText(new XMLSerializer().serializeToString(clone))
      setCopyState('svg')
      setTimeout(() => setCopyState(null), 2000)
    } catch {}
  }

  async function copyPng() {
    const clone = getCleanClone(false)
    if (!clone) return
    const vb = refineSvgRef.current.getAttribute('viewBox').split(' ')
    const vW = parseFloat(vb[2]), vH = parseFloat(vb[3])
    const pngH = Math.round(exportW * vH / vW)
    clone.setAttribute('width', exportW); clone.setAttribute('height', pngH)
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = exportW; canvas.height = pngH
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, exportW, pngH)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setCopyState('png')
          setTimeout(() => setCopyState(null), 2000)
        } catch {}
      }, 'image/png')
    }
    img.src = dataUrl
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  function getCleanClone(includeGuides) {
    const svgEl = refineSvgRef.current
    if (!svgEl) return null
    const clone = svgEl.cloneNode(true)
    clone.querySelectorAll('[data-handles]').forEach(el => el.remove())
    if (!includeGuides) clone.querySelectorAll('[data-guides]').forEach(el => el.remove())
    return clone
  }

  function exportSvg() {
    const clone = getCleanClone(false)
    if (!clone) return
    const vb = refineSvgRef.current.getAttribute('viewBox').split(' ')
    clone.setAttribute('width', exportW)
    clone.setAttribute('height', Math.round(exportW * parseFloat(vb[3]) / parseFloat(vb[2])))
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `logo-${activeVar}.svg`; a.click()
    markSaved('logo-maker')
    URL.revokeObjectURL(a.href)
  }

  function exportPng() {
    const clone = getCleanClone(pngIncludeGuides)
    if (!clone) return
    const vb = refineSvgRef.current.getAttribute('viewBox').split(' ')
    const vW = parseFloat(vb[2]), vH = parseFloat(vb[3])
    const pngH = Math.round(exportW * vH / vW)
    clone.setAttribute('width', exportW); clone.setAttribute('height', pngH)
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = exportW; canvas.height = pngH
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, exportW, pngH)
      ctx.drawImage(img, 0, 0)
      const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `logo-${activeVar}.png`; a.click()
      markSaved('logo-maker')
    }
    img.src = dataUrl
  }

  function exportGuidesSvg() {
    const svgEl = refineSvgRef.current
    if (!svgEl) return
    const vb = svgEl.getAttribute('viewBox').split(' ')
    const vW = parseFloat(vb[2]), vH = parseFloat(vb[3])
    const pngH = Math.round(exportW * vH / vW)

    const clone = svgEl.cloneNode(true)
    clone.querySelectorAll('image, [data-handles]').forEach(el => el.remove())
    clone.querySelectorAll(':not([data-guides]):not(defs):not(svg):not(filter):not(feColorMatrix)').forEach(el => {
      if (!el.closest('[data-guides]')) el.setAttribute('display', 'none')
    })
    clone.setAttribute('width', exportW); clone.setAttribute('height', pngH)
    clone.style.background = 'none'

    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `guides-${activeVar}.svg`; a.click()
    markSaved('logo-maker')
    URL.revokeObjectURL(a.href)
  }

  // ── Export All ───────────────────────────────────────────────────────────────
  function buildVariationSvg(variation) {
    const effectiveLayout = !iconFile ? 'w' : !wordmarkFile ? 'i' : variation.layout
    const lyt = computeLayout({
      layout: effectiveLayout,
      iconAspect: iconFile?.aspect ?? 1, wordmarkAspect: wordmarkFile?.aspect ?? 1,
      iconScale, gapRatio, alignment,
    })
    if (!lyt) return null
    const pad = Math.max(lyt.totalW, lyt.totalH) * 0.38
    const vW = lyt.totalW + pad * 2, vH = lyt.totalH + pad * 2
    const pxW = exportW, pxH = Math.round(exportW * vH / vW)

    const mkFilter = (id, hex) => {
      const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255
      return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 ${r.toFixed(4)} 0 0 0 0 ${g.toFixed(4)} 0 0 0 0 ${b.toFixed(4)} 0 0 0 1 0"/></filter>`
    }

    let defs = ''
    let bgRect = `<rect width="${vW}" height="${vH}" fill="${bgColor}"/>`
    let iconFilter = ''
    let wmFilter = ''

    if (activeTreatment !== 'original') {
      defs += buildTreatmentFilterStr(activeTreatment, treatmentSpotColor, treatmentDuotoneDark, treatmentDuotoneLight)
      iconFilter = ' filter="url(#treatment)"'
      wmFilter = ' filter="url(#treatment)"'
    } else {
      if (iconColorOn && iconFile) defs += mkFilter('tint-icon', iconColor)
      if (wordmarkColorOn && wordmarkFile) defs += mkFilter('tint-wm', wordmarkColor)
      if (iconColorOn) iconFilter = ' filter="url(#tint-icon)"'
      if (wordmarkColorOn) wmFilter = ' filter="url(#tint-wm)"'
    }

    let body = bgRect

    // For knockout, add spot-color bg before the images
    if (activeTreatment === 'knockout') {
      body += `<rect width="${vW}" height="${vH}" fill="${treatmentSpotColor}"/>`
    }

    const iconImg = lyt.icon && iconFile
      ? `<image href="${iconFile.dataUrl}" x="${pad+lyt.icon.x}" y="${pad+lyt.icon.y}" width="${lyt.icon.w}" height="${lyt.icon.h}" preserveAspectRatio="xMidYMid meet"/>`
      : ''
    const wmImg = lyt.wordmark && wordmarkFile
      ? `<image href="${wordmarkFile.dataUrl}" x="${pad+lyt.wordmark.x}" y="${pad+lyt.wordmark.y}" width="${lyt.wordmark.w}" height="${lyt.wordmark.h}" preserveAspectRatio="xMidYMid meet"/>`
      : ''

    const dividerRect = lyt.divider
      ? `<rect x="${(pad + lyt.divider.x).toFixed(4)}" y="${(pad + lyt.divider.y).toFixed(4)}" width="${lyt.divider.w.toFixed(4)}" height="${lyt.divider.h.toFixed(4)}" fill="${activeTreatment !== 'original' ? '#ffffff' : wordmarkColorOn ? wordmarkColor : iconColorOn ? iconColor : '#ffffff'}"/>`
      : ''

    if (activeTreatment !== 'original') {
      body += `<g filter="url(#treatment)">${iconImg}${wmImg}${dividerRect}</g>`
    } else {
      if (lyt.icon && iconFile) {
        body += `<image href="${iconFile.dataUrl}" x="${pad+lyt.icon.x}" y="${pad+lyt.icon.y}" width="${lyt.icon.w}" height="${lyt.icon.h}" preserveAspectRatio="xMidYMid meet"${iconFilter}/>`
      }
      if (lyt.wordmark && wordmarkFile) {
        body += `<image href="${wordmarkFile.dataUrl}" x="${pad+lyt.wordmark.x}" y="${pad+lyt.wordmark.y}" width="${lyt.wordmark.w}" height="${lyt.wordmark.h}" preserveAspectRatio="xMidYMid meet"${wmFilter}/>`
      }
      body += dividerRect
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vW} ${vH}" width="${pxW}" height="${pxH}"><defs>${defs}</defs>${body}</svg>`
    return { svg, pxW, pxH }
  }

  function svgToPngBase64(svgString, pxW, pxH) {
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = pxW; canvas.height = pxH
        canvas.getContext('2d').drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png').split(',')[1])
      }
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
    })
  }

  async function exportAll() {
    if (!window.electron) return
    const folder = await window.electron.pickFolder()
    if (!folder) return
    setExportingAll(true)
    for (const variation of VARIATIONS) {
      if (exportEnabled[variation.id] === false) continue
      const ok = (BOTH_LAYOUTS.includes(variation.layout) && hasBoth) ||
                 (variation.layout === 'i' && iconFile) ||
                 (variation.layout === 'w' && wordmarkFile)
      if (!ok) continue
      const result = buildVariationSvg(variation)
      if (!result) continue
      const { svg, pxW, pxH } = result
      if (exportAllSvg) await window.electron.writeFile(`${folder}/svg/logo-${variation.id}.svg`, svg, 'utf8')
      if (exportAllPng) await window.electron.writeFile(`${folder}/png/logo-${variation.id}.png`, await svgToPngBase64(svg, pxW, pxH), 'base64')
    }
    setExportingAll(false)
    setExportAllDone(true)
    setTimeout(() => setExportAllDone(false), 3000)
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const activeVariation = VARIATIONS.find(v => v.id === activeVar) ?? VARIATIONS[0]
  const hasBoth = !!(iconFile && wordmarkFile)
  const isPreviewOnlyVariation = activeVariation.previewOnly

  const sharedLockupProps = {
    icon: iconFile, wordmark: wordmarkFile,
    iconColorOn, iconColor, wordmarkColorOn, wordmarkColor,
    showGuides, guideColor, showSafeZone,
    iconScale, gapRatio, alignment,
    treatment: activeTreatment,
    treatmentSpotColor,
    treatmentDuotoneDark,
    treatmentDuotoneLight,
    showClearspace,
    clearspaceN,
  }

  const mathLines = (() => {
    if (!iconFile || !wordmarkFile) return []
    const pct = v => `${Math.round(v * 100)}%`
    return lockAnchor === 'wordmark'
      ? [`Icon = ${pct(iconScale)} of wordmark height`, `Gap = ${pct(gapRatio)} of wordmark height`]
      : [`Wordmark = ${pct(1 / iconScale)} of icon height`, `Gap = ${pct(gapRatio / iconScale)} of icon height`]
  })()

  const alignOpts = ['v', 'vr'].includes(activeVariation.layout)
    ? [{ value: 'left', label: '←' }, { value: 'center', label: '⊕' }, { value: 'right', label: '→' }]
    : [{ value: 'top', label: '↑' }, { value: 'center', label: '⊕' }, { value: 'bottom', label: '↓' }]
  // Layouts that support alignment controls (il/ilr/sup/sub/cs have fixed compositions)
  const ALIGNMENT_LAYOUTS = ['h', 'hr', 'v', 'vr', 'dh', 'dhr']

  // ── Drag handles ────────────────────────────────────────────────────────────
  function renderHandles() {
    if (!hasBoth || isPreviewOnlyVariation) return null
    const lyt = computeLayout({
      layout: activeVariation.layout,
      iconAspect: iconFile.aspect, wordmarkAspect: wordmarkFile.aspect,
      iconScale, gapRatio, alignment,
    })
    if (!lyt) return null
    const pad = Math.max(lyt.totalW, lyt.totalH) * 0.38
    const target = lockAnchor === 'wordmark' ? lyt.icon : lyt.wordmark
    if (!target) return null
    const x0 = pad + target.x, y0 = pad + target.y
    const x1 = x0 + target.w, y1 = y0 + target.h
    const hSize = Math.min(lyt.totalW, lyt.totalH) * 0.055
    return (
      <g>
        <Handle cx={x0} cy={y0} size={hSize} onMouseDown={e => startHandleDrag(e, -1)} />
        <Handle cx={x1} cy={y0} size={hSize} onMouseDown={e => startHandleDrag(e, -1)} />
        <Handle cx={x0} cy={y1} size={hSize} onMouseDown={e => startHandleDrag(e, +1)} />
        <Handle cx={x1} cy={y1} size={hSize} onMouseDown={e => startHandleDrag(e, +1)} />
      </g>
    )
  }

  // ── Compute logoColor for WCAG ───────────────────────────────────────────────
  const logoColor = (() => {
    if (activeTreatment === 'mono-black') return '#000000'
    if (activeTreatment === 'mono-white') return '#ffffff'
    if (activeTreatment === 'single-spot' || activeTreatment === 'knockout') return treatmentSpotColor
    if (activeTreatment === 'duotone') return treatmentDuotoneLight
    if (iconColorOn) return iconColor
    if (isSvgLikelyBlack(iconFile?.raw)) return '#000000'
    return '#ffffff'
  })()

  // ── Panel ───────────────────────────────────────────────────────────────────
  const showProportionControls = step === 2 && !isPreviewOnlyVariation
  const showAlignmentControls = showProportionControls && ALIGNMENT_LAYOUTS.includes(activeVariation.layout)

  const panel = (
    <div style={{
      width: panelW, minWidth: panelW, background: C.panel,
      borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative', flexShrink: 0,
    }}>
      <div onMouseDown={startPanelResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 10 }} />

      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 2, textTransform: 'uppercase' }}>
        Logo Maker
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 20px' }}>

        {(step === 2 || step === 'favicon') && (
          <button onClick={() => setStep(1)} style={{ ...btn(true), display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: '5px 10px', fontSize: 11, width: '100%' }}>
            ← Back to overview
          </button>
        )}

        <Section title="Import">
          <FileSlot label="Icon" file={iconFile}
            onFile={f => { setIconFile(f); if (f.type === 'svg' && isSvgLikelyBlack(f.raw)) setIconColorOn(true) }}
            onClear={() => setIconFile(null)} />
          <FileSlot label="Wordmark" file={wordmarkFile}
            onFile={f => { setWordmarkFile(f); if (f.type === 'svg' && isSvgLikelyBlack(f.raw)) setWordmarkColorOn(true) }}
            onClear={() => setWordmarkFile(null)} />
          <div style={{ fontSize: 10, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
            Paste SVG from clipboard with Ctrl+V
          </div>
        </Section>

        {showProportionControls && (
          <Section title="Proportions">
            <Row label="Lock anchor">
              <SegmentedControl
                options={[{ value: 'wordmark', label: 'Wordmark' }, { value: 'icon', label: 'Icon' }]}
                value={lockAnchor} onChange={setLockAnchor}
              />
            </Row>
            <SliderRow label="Icon scale" min={0.1} max={3} step={0.01} value={iconScale} onChange={setIconScale} toFixed={2} />
            <SliderRow label="Gap" min={0} max={2} step={0.01} value={gapRatio} onChange={setGapRatio} toFixed={2} />
            {mathLines.length > 0 && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: C.ctrl, borderRadius: 4, borderLeft: `2px solid ${C.accent}` }}>
                {mathLines.map((l, i) => <div key={i} style={{ fontSize: 11, color: C.text, lineHeight: 1.7 }}>{l}</div>)}
              </div>
            )}
          </Section>
        )}

        {showAlignmentControls && (
          <Section title="Alignment">
            <SegmentedControl options={alignOpts} value={alignment} onChange={setAlignment} />
          </Section>
        )}

        <Section title="Canvas">
          <Row label="Background"><HexInput value={bgColor} onChange={setBgColor} /></Row>
          <Toggle label="Guides" value={showGuides} onChange={setShowGuides} />
          {showGuides && <Row label="Guide color"><HexInput value={guideColor} onChange={setGuideColor} /></Row>}
          <Toggle label="Background contexts" value={showBgContext} onChange={setShowBgContext} />
          {showBgContext && (
            <Row label="Brand color"><HexInput value={brandColor} onChange={setBrandColor} /></Row>
          )}
        </Section>

        <Section title="Colors">
          <Toggle label="Override icon color" value={iconColorOn} onChange={setIconColorOn} />
          {iconColorOn && <Row label="Icon color"><HexInput value={iconColor} onChange={setIconColor} /></Row>}
          <Toggle label="Override wordmark color" value={wordmarkColorOn} onChange={setWordmarkColorOn} />
          {wordmarkColorOn && <Row label="WM color"><HexInput value={wordmarkColor} onChange={setWordmarkColor} /></Row>}
        </Section>

        <Section title="Treatment">
          <TreatmentPicker
            treatment={activeTreatment} onTreatment={setActiveTreatment}
            spotColor={treatmentSpotColor} onSpotColor={setTreatmentSpotColor}
            duotoneDark={treatmentDuotoneDark} onDuotoneDark={setTreatmentDuotoneDark}
            duotoneLight={treatmentDuotoneLight} onDuotoneLight={setTreatmentDuotoneLight}
          />
        </Section>

        <Section title="Session">
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={handleSave} style={{ ...btn(true), flex: 1, transition: 'opacity 0.15s' }}>
              {saved ? '✓ Saved' : 'Save'}
            </button>
            <button onClick={handleLoad} style={{ ...btn(), flex: 1 }}>Load</button>
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>● Auto-saved · Save writes to app data folder</div>
        </Section>

        <Section title="Overlays">
          <Toggle label="Safe zone / clear space" value={showSafeZone} onChange={setShowSafeZone} />
          {showSafeZone && <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>Clear space = 50% of lockup height</div>}
        </Section>

        <ClearspaceSection
          showClearspace={showClearspace} onShowClearspace={setShowClearspace}
          clearspaceN={clearspaceN} onClearspaceN={setClearspaceN}
          showMinSizes={showMinSizes} onShowMinSizes={setShowMinSizes}
        />

        {(iconFile || wordmarkFile) && (
          <Section title="Favicon">
            <button
              onClick={() => setStep('favicon')}
              style={{ ...btn(step === 'favicon'), width: '100%', padding: '7px 0' }}
            >
              ⬡ Favicon View
            </button>
          </Section>
        )}

        {step === 2 && (
          <Section title="Export">
            <SliderRow label="Width (px)" min={512} max={4096} step={1} value={exportW} onChange={setExportW} toFixed={0} />
            <Toggle label="Include guides in PNG" value={pngIncludeGuides} onChange={setPngIncludeGuides} />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={exportSvg} style={{ ...btn(), flex: 1, padding: '6px 0', textAlign: 'center' }}>SVG</button>
              <button onClick={exportPng} style={{ ...btn(true), flex: 1, padding: '6px 0', textAlign: 'center' }}>PNG</button>
              <button onClick={exportGuidesSvg} style={{ ...btn(), flex: '0 0 100%', padding: '6px 0', textAlign: 'center', marginTop: 2 }}>Export guides (SVG overlay)</button>
            </div>

            {/* Export All */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>All variations</div>

              {/* Per-variation export toggles */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', marginBottom: 10 }}>
                {VARIATIONS.map(v => {
                  const on = exportEnabled[v.id] !== false
                  return (
                    <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: on ? C.text : C.muted, userSelect: 'none' }}>
                      <input type="checkbox" checked={on}
                        onChange={e => setExportEnabled(prev => ({ ...prev, [v.id]: e.target.checked }))}
                        style={{ accentColor: C.accent, width: 11, height: 11, cursor: 'pointer', flexShrink: 0 }} />
                      {v.label}
                    </label>
                  )
                })}
              </div>

              {/* Format toggles */}
              <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
                {[['SVG', exportAllSvg, setExportAllSvg], ['PNG', exportAllPng, setExportAllPng]].map(([label, val, set]) => (
                  <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: val ? C.text : C.muted }}>
                    <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                      style={{ accentColor: C.accent, width: 13, height: 13, cursor: 'pointer' }} />
                    {label}
                  </label>
                ))}
              </div>

              <button
                onClick={exportAll}
                disabled={exportingAll || (!exportAllSvg && !exportAllPng)}
                style={{ ...btn(true), width: '100%', padding: '7px 0', opacity: (!exportAllSvg && !exportAllPng) ? 0.4 : 1 }}
              >
                {exportingAll ? 'Exporting…' : exportAllDone ? '✓ Done' : '⬇ Export All to Folder'}
              </button>
            </div>
          </Section>
        )}
      </div>
    </div>
  )

  // ── Overview step ────────────────────────────────────────────────────────────
  function renderOverview() {
    if (!iconFile && !wordmarkFile) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ fontSize: 32, opacity: 0.12, color: C.muted }}>◫</div>
          <div style={{ fontSize: 12, color: C.muted }}>Load an icon and wordmark in the panel to get started</div>
          <div style={{ fontSize: 11, color: C.dim }}>SVG or PNG · drag & drop or browse · paste SVG with Ctrl+V</div>
        </div>
      )
    }
    return (
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: 'repeat(5, 1fr)', gap: 2, padding: 2, overflow: 'hidden' }}>
        {VARIATIONS.map(v => {
          const applicable = (
            (v.layout === 'i' && iconFile) ||
            (v.layout === 'w' && wordmarkFile) ||
            (BOTH_LAYOUTS.includes(v.layout) && hasBoth)
          )
          return (
            <VariationCard key={v.id} variation={v} applicable={applicable}
              lockupProps={{ ...sharedLockupProps, layout: v.layout }}
              bgColor={bgColor}
              active={activeVar === v.id}
              onClick={applicable ? () => { setActiveVar(v.id); setStep(2) } : null}
            />
          )
        })}
      </div>
    )
  }

  // ── Refine step ─────────────────────────────────────────────────────────────
  function renderRefine() {
    // Build a clean SVG string for MinSizeStrip (no handles, no guides)
    const getMinSizeSvgString = () => {
      const svgEl = refineSvgRef.current
      if (!svgEl) return null
      const clone = svgEl.cloneNode(true)
      clone.querySelectorAll('[data-handles]').forEach(el => el.remove())
      clone.querySelectorAll('[data-guides]').forEach(el => el.remove())
      return new XMLSerializer().serializeToString(clone)
    }

    // Build data URL for BackgroundRow
    const getBackgroundRowDataUrl = () => {
      const svgEl = refineSvgRef.current
      if (!svgEl) return null
      const clone = svgEl.cloneNode(true)
      clone.querySelectorAll('[data-handles]').forEach(el => el.remove())
      clone.querySelectorAll('[data-guides]').forEach(el => el.remove())
      const str = new XMLSerializer().serializeToString(clone)
      try {
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(str)))
      } catch {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str)
      }
    }

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 38, background: C.panel, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {activeVariation.label}
            {isPreviewOnlyVariation && <span style={{ fontSize: 10, color: C.muted, fontWeight: 400, marginLeft: 8, letterSpacing: 0.5 }}>preview only</span>}
          </span>
          {mathLines.map((l, i) => <span key={i} style={{ fontSize: 11, color: C.muted }}>{l}</span>)}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={copySvg} title="Copy SVG to clipboard" style={{ ...btn(false), padding: '3px 8px', fontSize: 11, color: copyState === 'svg' ? C.accent : C.text }}>
              {copyState === 'svg' ? '✓ SVG' : '⎘ SVG'}
            </button>
            <button onClick={copyPng} title="Copy PNG to clipboard" style={{ ...btn(false), padding: '3px 8px', fontSize: 11, color: copyState === 'png' ? C.accent : C.text }}>
              {copyState === 'png' ? '✓ PNG' : '⎘ PNG'}
            </button>
            <div style={{ width: 1, height: 14, background: C.border, margin: '0 4px' }} />
            {VARIATIONS.map(v => (
              <button key={v.id} onClick={() => setActiveVar(v.id)} style={{ ...btn(v.id === activeVar), padding: '3px 8px', fontSize: 11 }}>{v.label}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bgColor, position: 'relative' }}>
          {iconFile || wordmarkFile ? (
            <LockupSvg {...sharedLockupProps} layout={activeVariation.layout}
              svgRef={refineSvgRef} style={{ width: '100%', height: '100%', display: 'block' }}>
              {renderHandles()}
            </LockupSvg>
          ) : (
            <div style={{ color: C.muted, fontSize: 12 }}>No files loaded</div>
          )}
        </div>
        {showMinSizes && refineSvgRef.current && (
          <MinSizeStrip svgString={getMinSizeSvgString()} bgColor={bgColor} />
        )}
        {showBgContext && (iconFile || wordmarkFile) && (
          <BackgroundRow
            svgDataUrl={getBackgroundRowDataUrl()}
            logoColor={logoColor}
            brandColor={brandColor}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, overflow: 'hidden' }}>
      {panel}
      {step === 1 && renderOverview()}
      {step === 2 && renderRefine()}
      {step === 'favicon' && (
        <FaviconView
          iconFile={iconFile}
          wordmarkFile={wordmarkFile}
          hasBoth={hasBoth}
          buildVariationSvg={buildVariationSvg}
          bgColor={bgColor}
          onBack={() => setStep(1)}
        />
      )}
    </div>
  )
}
