// ── cobalt.tools — embedded media downloader + batch downloader ───────────────
// Two modes:
//   • "Site"  — the real cobalt.tools loaded in Electron's <webview> (it blocks
//     <iframe> embedding, webview doesn't). One link at a time, as the site does.
//   • "Batch" — same site, automated. The site's API now requires Turnstile auth,
//     so rather than call an API we drive the *page*: for each link we fill the
//     cobalt input and click download, the site does its own Turnstile +
//     processing, and the resulting browser download is captured by the main
//     process (electron/main.js) and saved straight to the chosen folder.
// Outside Electron (dev browser preview) <webview> doesn't exist → link fallback.

import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { markDirty, markSaved } from '../lib/unsavedChanges.js'

const COBALT_URL = 'https://cobalt.tools'

const LS = { folder: 'cobalt.folder' }
const load = (k, d = '') => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, v) } catch {} }

const isSoundcloudPlaylist = (u) => /soundcloud\.com\/[^/]+\/sets\//i.test(u)

export default function CobaltTool() {
  const isElectron = typeof window !== 'undefined' && !!window.electron
  const [tab, setTab] = useState('batch')

  if (!isElectron) {
    return (
      <div style={fallbackWrap}>
        <div>cobalt.tools runs inside the desktop app.</div>
        <a href={COBALT_URL} target="_blank" rel="noreferrer" style={{ color: '#7dd3fc', fontSize: 12 }}>
          Open cobalt.tools in your browser
        </a>
      </div>
    )
  }

  // Keep the Batch panel mounted across tab switches (its webview must stay alive
  // to receive the cobalt session). We just toggle visibility.
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#0b0b0d' }}>
      <div style={tabBar}>
        <TabButton active={tab === 'site'}  onClick={() => setTab('site')}  icon="public"      label="Site" />
        <TabButton active={tab === 'batch'} onClick={() => setTab('batch')} icon="queue_music" label="Batch download" />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === 'site' ? 'flex' : 'none' }}>
        <webview src={COBALT_URL} partition="persist:cobalt" allowpopups="true" style={{ flex: 1, border: 'none' }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === 'batch' ? 'flex' : 'none' }}>
        <BatchPanel />
      </div>
    </div>
  )
}

function BatchPanel() {
  const [folder,  setFolder]  = useState(() => load(LS.folder))
  const [text,    setText]    = useState('')
  const [items,   setItems]   = useState([])   // { url, status, detail }
  const [running, setRunning] = useState(false)
  const [ready,   setReady]   = useState(false)

  const webviewRef = useRef(null)
  const pendingRef = useRef(null)   // resolver for the next captured download

  // Warn before closing while a batch download is mid-flight.
  useEffect(() => {
    if (running) markDirty('cobalt')
    else markSaved('cobalt')
  }, [running])
  useEffect(() => () => markSaved('cobalt'), [])

  // Listen for downloads captured by the main process.
  useEffect(() => {
    if (!window.electron?.onCobaltDownload) return
    return window.electron.onCobaltDownload((data) => {
      if (pendingRef.current) { pendingRef.current(data); pendingRef.current = null }
    })
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onReady = () => setReady(true)
    wv.addEventListener('dom-ready', onReady)
    return () => wv.removeEventListener('dom-ready', onReady)
  }, [])

  const pickFolder = async () => {
    const f = await window.electron.pickFolder()
    if (f) { setFolder(f); save(LS.folder, f) }
  }

  const patch = (i, p) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...p } : it))

  // Set the cobalt input to `url` (clearing any previous value first), verify it
  // actually changed, then submit it ONCE. Returns 'submitted' | 'no-input' |
  // 'set-failed'. cobalt is a Svelte app, so we update value via the native
  // setter + an 'input' event so its bound state stays in sync.
  const triggerInPage = (url) => {
    const js = `(function(){
      function setVal(el,v){
        var proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
        var d=Object.getOwnPropertyDescriptor(proto,'value');
        if(d&&d.set){d.set.call(el,v);} else {el.value=v;}
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      var input = document.querySelector('#link-area')
        || document.querySelector('input[placeholder*="link" i]')
        || document.querySelector('input[type="url"]')
        || document.querySelector('input[type="text"]')
        || document.querySelector('textarea');
      if(!input) return 'no-input';
      input.focus();
      setVal(input, '');                 // clear previous link first
      setVal(input, ${JSON.stringify(url)});
      if(input.value !== ${JSON.stringify(url)}) return 'set-failed';
      // Submit exactly once: prefer the dedicated download button, else Enter.
      var btn = document.querySelector('#download-button')
        || document.querySelector('button[aria-label*="download" i]')
        || document.querySelector('button[type="submit"]');
      if(btn && !btn.disabled){ btn.click(); return 'submitted'; }
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      return 'submitted';
    })()`
    return webviewRef.current.executeJavaScript(js, true)
  }

  // After a link is processed, cobalt parks the result in its "processing queue"
  // with a per-item save (download) button you must click to actually write the
  // file. Click any not-yet-handled save buttons, marking each so it's never
  // clicked twice (which previously caused duplicate downloads). Returns the
  // number of buttons clicked.
  const clickQueueSaves = () => {
    const js = `(function(){
      var queue = document.querySelector('#processing-queue')
        || document.querySelector('[class*="queue" i]')
        || document.querySelector('[class*="processing" i]');
      var scope = queue || document;
      var btns = Array.prototype.slice.call(scope.querySelectorAll('button, a'));
      var n = 0;
      btns.forEach(function(b){
        if(b.id==='download-button') return;            // never the main submit
        if(b.dataset.batchClicked) return;              // already handled
        var lbl = ((b.getAttribute('aria-label')||'')+' '+(b.title||'')+' '+(b.textContent||'')).toLowerCase();
        if(/(save|download)/.test(lbl) && !/(clear|remove|delete|cancel|retry|copy|share|close)/.test(lbl)){
          b.dataset.batchClicked = '1';
          b.click();
          n++;
        }
      });
      return n;
    })()`
    return webviewRef.current.executeJavaScript(js, true)
  }

  // Arms pendingRef and a timeout. Returns { promise, cancel } so callers can
  // tear it down cleanly if the submit never happened.
  const waitForDownload = (timeoutMs) => {
    let t
    const promise = new Promise((resolve) => {
      t = setTimeout(() => {
        if (pendingRef.current === resolver) { pendingRef.current = null; resolve({ state: 'timeout' }) }
      }, timeoutMs)
      var resolver = (data) => { clearTimeout(t); pendingRef.current = null; resolve(data) }
      pendingRef.current = resolver
    })
    const cancel = () => { clearTimeout(t); pendingRef.current = null }
    return { promise, cancel }
  }

  const run = async () => {
    if (!folder) return alert('Choose a destination folder first.')
    if (!webviewRef.current) return
    const raw = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean)
    if (!raw.length) return

    setRunning(true)

    // Expand any SoundCloud playlists into their individual track links first.
    const queue = []
    for (const url of raw) {
      if (isSoundcloudPlaylist(url)) {
        setItems(prev => [...prev, { url, status: 'working', detail: 'expanding playlist…' }])
        try {
          const tracks = await window.electron.soundcloudExpand(url)
          if (tracks.length) { queue.push(...tracks) }
          else { queue.push(url) }
        } catch {
          queue.push(url)   // expansion failed — let cobalt try the raw URL
        }
      } else {
        queue.push(url)
      }
    }

    setItems(queue.map(url => ({ url, status: 'pending', detail: '' })))
    await window.electron.cobaltSetDownloadDir(folder)

    for (let i = 0; i < queue.length; i++) {
      patch(i, { status: 'working', detail: '' })

      // Arm the download listener BEFORE submitting so we can't miss a fast
      // download that fires before we start waiting.
      const wait = waitForDownload(180000)

      let res
      try {
        res = await triggerInPage(queue[i])
      } catch (e) {
        wait.cancel()
        patch(i, { status: 'error', detail: 'page not ready' })
        continue
      }
      if (res !== 'submitted') {
        wait.cancel()
        patch(i, { status: 'error', detail: res === 'set-failed' ? 'could not set link' : 'cobalt input not found' })
        continue
      }

      // Poll cobalt's processing queue and click the per-item save button once
      // it appears, until the download is captured (or we time out).
      let settled = false
      const poller = (async () => {
        for (let a = 0; a < 60 && !settled; a++) {
          await new Promise(r => setTimeout(r, 500))
          try { await clickQueueSaves() } catch {}
        }
      })()

      const dl = await wait.promise
      settled = true
      await poller
      if (dl.state === 'completed') patch(i, { status: 'done', detail: (dl.path || dl.filename || '').split(/[\\/]/).pop() })
      else if (dl.state === 'timeout') patch(i, { status: 'error', detail: 'no download (Turnstile? format popup?)' })
      else patch(i, { status: 'error', detail: dl.state || 'failed' })

      // Small gap so cobalt finishes settling its queue before the next link.
      await new Promise(r => setTimeout(r, 600))
    }
    setRunning(false)
  }

  const done = items.filter(i => i.status === 'done').length
  const failed = items.filter(i => i.status === 'error').length

  return (
    <div style={panelWrap}>
      <div style={controls}>
        <button onClick={pickFolder} style={folderBtn} title={folder || 'Choose folder'}>
          <Icon name="folder" size={14} />
          <span style={folderText}>{folder || 'Choose folder…'}</span>
        </button>
        <button onClick={run} disabled={running} style={{ ...runBtn, opacity: running ? 0.6 : 1 }}>
          <Icon name="download" size={15} />
          {running ? 'Downloading…' : 'Download all'}
        </button>
        {items.length > 0 && (
          <div style={{ fontSize: 12, color: '#999' }}>
            {done} done{failed ? ` · ${failed} failed` : ''} · {items.length} total
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#777' }}>
        Paste links or a SoundCloud playlist (/sets/) URL — playlists expand to their tracks automatically.
        Each track is fed to the cobalt page below and saved to your folder. Set your preferred format (e.g. audio)
        and solve any Turnstile check once in the page below — the batch reuses that session.
        {!ready && ' · loading cobalt…'}
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'https://soundcloud.com/artist/sets/my-playlist\nhttps://soundcloud.com/artist/track\nhttps://youtube.com/watch?v=…'}
        spellCheck={false}
        style={textarea}
      />

      {items.length > 0 && (
        <div style={list}>
          {items.map((it, i) => (
            <div key={i} style={row}>
              <StatusIcon status={it.status} />
              <span style={rowUrl} title={it.url}>{it.url}</span>
              <span style={rowDetail}>{it.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* The live cobalt page that actually performs each download. */}
      <webview
        ref={webviewRef}
        src={COBALT_URL}
        partition="persist:cobalt"
        allowpopups="true"
        style={{ flex: 1, minHeight: 220, border: '1px solid #1d1d22', borderRadius: 6 }}
      />
    </div>
  )
}

function StatusIcon({ status }) {
  if (status === 'done')  return <Icon name="check_circle" size={15} color="#4ade80" />
  if (status === 'error') return <Icon name="error" size={15} color="#f87171" />
  if (status === 'working') return <Icon name="download" size={14} color="#7dd3fc" />
  return <Icon name="download" size={14} color="#888" style={{ opacity: 0.4 }} />
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} style={{ ...tabBtn, ...(active ? tabBtnActive : {}) }}>
      <Icon name={icon} size={14} />{label}
    </button>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────
const fallbackWrap = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 12, color: '#888',
  fontSize: 13, textAlign: 'center', padding: 24,
}
const tabBar = { display: 'flex', gap: 4, padding: '8px 10px 0', borderBottom: '1px solid #1d1d22' }
const tabBtn = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 12,
  color: '#888', background: 'transparent', border: 'none', borderBottom: '2px solid transparent',
  cursor: 'pointer',
}
const tabBtnActive = { color: '#f0ede7', borderBottom: '2px solid #7dd3fc' }
const panelWrap = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }
const controls = { display: 'flex', alignItems: 'center', gap: 10 }
const folderBtn = {
  display: 'flex', alignItems: 'center', gap: 7, background: '#141418', border: '1px solid #26262d',
  borderRadius: 6, color: '#f0ede7', fontSize: 12, padding: '8px 10px', cursor: 'pointer',
  textAlign: 'left', maxWidth: 360, flex: '0 1 auto',
}
const folderText = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const textarea = {
  minHeight: 90, resize: 'vertical', background: '#141418', border: '1px solid #26262d',
  borderRadius: 6, color: '#f0ede7', fontSize: 12, padding: 10, outline: 'none',
  fontFamily: 'ui-monospace, monospace', lineHeight: 1.6,
}
const runBtn = {
  display: 'flex', alignItems: 'center', gap: 7, background: '#7dd3fc', color: '#06283d',
  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer',
}
const list = { display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid #1d1d22', borderRadius: 6, padding: 6, maxHeight: 180, overflow: 'auto' }
const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 11.5 }
const rowUrl = { color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 0' }
const rowDetail = { color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%' }
