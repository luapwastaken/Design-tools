const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, session } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged

let mainWin = null

// Set by the renderer (see preload.js / src/lib/unsavedChanges.js) whenever the
// combined unsaved-work flag across all tools changes.
let hasUnsavedChanges = false
ipcMain.on('app:unsavedChanges', (_, flag) => { hasUnsavedChanges = !!flag })

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111114',
      symbolColor: '#f0ede7',
      height: 36
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0b0b0d',
    show: true
  })

  mainWin = win

  // Warn before closing if any tool has unsaved edits.
  win.on('close', (e) => {
    if (!hasUnsavedChanges) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Unsaved changes',
      message: 'You have unsaved changes',
      detail: 'Some of your work hasn’t been saved or exported yet. Quit anyway?',
    })
    if (choice === 0) e.preventDefault()
    else hasUnsavedChanges = false
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function sessionsDir() {
  const dir = path.join(app.getPath('userData'), 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose export folder' })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:writeFile', (_, { filePath, data, encoding }) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, encoding === 'base64' ? Buffer.from(data, 'base64') : data, encoding === 'base64' ? undefined : 'utf8')
})

ipcMain.handle('session:save', (_, { key, data }) => {
  fs.writeFileSync(path.join(sessionsDir(), `${key}.json`), data, 'utf8')
})

ipcMain.handle('session:load', (_, { key }) => {
  const file = path.join(sessionsDir(), `${key}.json`)
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
})

// ── Screen colour picker — multi-monitor live preview ─────────────────────────

// Returns one entry per physical display: { id, name, displayId }
ipcMain.handle('eyedropper:sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },  // skip thumbnails — we only need IDs
  })
  return sources.map(s => ({ id: s.id, name: s.name, displayId: s.display_id }))
})

// Current cursor position in logical screen coordinates (works on all monitors)
ipcMain.handle('eyedropper:cursor', () => screen.getCursorScreenPoint())

// All display bounds + scale factors so the renderer can map cursor → video coords
ipcMain.handle('eyedropper:displays', () =>
  screen.getAllDisplays().map(d => ({
    id: d.id,
    bounds: d.bounds,           // { x, y, width, height } — logical pixels
    scaleFactor: d.scaleFactor,
  }))
)

// ── cobalt batch downloader ───────────────────────────────────────────────────
// cobalt.tools is one-link-at-a-time and its API now needs Turnstile auth, so
// instead of calling an API we drive the real site loaded in the <webview>: the
// renderer feeds it each link, the site does its own Turnstile + processing, and
// the resulting browser download is captured here and saved straight to the
// chosen folder (no save dialogs). We report each download's outcome back to the
// renderer so it can advance the queue.

let cobaltDownloadDir = null

function uniquePath(dir, name) {
  const safe = String(name || `download-${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_').trim()
  let target = path.join(dir, safe)
  if (fs.existsSync(target)) {
    const ext = path.extname(safe)
    const stem = path.basename(safe, ext)
    let i = 2
    while (fs.existsSync(path.join(dir, `${stem} (${i})${ext}`))) i++
    target = path.join(dir, `${stem} (${i})${ext}`)
  }
  return target
}

// Route every download from the cobalt webview's session straight to disk.
function setupCobaltDownloads() {
  const ses = session.fromPartition('persist:cobalt')
  ses.on('will-download', (_event, item) => {
    if (cobaltDownloadDir) {
      try {
        fs.mkdirSync(cobaltDownloadDir, { recursive: true })
        item.setSavePath(uniquePath(cobaltDownloadDir, item.getFilename()))
      } catch {}
    }
    item.once('done', (_e, state) => {
      mainWin?.webContents.send('cobalt:download-event', {
        state,                              // 'completed' | 'interrupted' | 'cancelled'
        filename: item.getFilename(),
        path: item.getSavePath(),
      })
    })
  })
}

// Where the next captured downloads should be saved.
ipcMain.handle('cobalt:setDownloadDir', (_, dir) => { cobaltDownloadDir = dir })

// ── SoundCloud playlist expansion ─────────────────────────────────────────────
// cobalt only takes single track links, so a /sets/ playlist URL is expanded
// here into its individual track permalink URLs using SoundCloud's own public
// API (no auth — just a scraped public client_id).

const SC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

let scClientId = null
async function soundcloudClientId() {
  if (scClientId) return scClientId
  const html = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': SC_UA } })).text()
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(s => s.includes('sndcdn.com'))
  for (const src of scripts.reverse()) {
    const js = await (await fetch(src, { headers: { 'User-Agent': SC_UA } })).text()
    const m = /client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/.exec(js)
    if (m) { scClientId = m[1]; return scClientId }
  }
  throw new Error('could not obtain a SoundCloud client_id')
}

// Expand a SoundCloud playlist (/sets/) URL into its track permalink URLs.
ipcMain.handle('soundcloud:expand', async (_, url) => {
  const clientId = await soundcloudClientId()
  const resolved = await (await fetch(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    { headers: { 'User-Agent': SC_UA } },
  )).json()
  if (resolved.kind !== 'playlist' && resolved.kind !== 'system-playlist') {
    throw new Error('not a SoundCloud playlist')
  }
  const tracks = resolved.tracks || []
  const byId = new Map()
  const stubIds = []
  for (const t of tracks) {
    if (t.permalink_url) byId.set(t.id, t.permalink_url)
    else if (t.id) stubIds.push(t.id)
  }
  // Most tracks come back as id-only stubs — resolve them 50 at a time.
  for (let i = 0; i < stubIds.length; i += 50) {
    const ids = stubIds.slice(i, i + 50).join(',')
    const full = await (await fetch(
      `https://api-v2.soundcloud.com/tracks?ids=${ids}&client_id=${clientId}`,
      { headers: { 'User-Agent': SC_UA } },
    )).json()
    for (const t of full) if (t?.permalink_url) byId.set(t.id, t.permalink_url)
  }
  return tracks.map(t => byId.get(t.id)).filter(Boolean)   // preserve playlist order
})

app.whenReady().then(() => {
  setupCobaltDownloads()
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
