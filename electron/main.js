const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen } = require('electron')
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

app.whenReady().then(() => {
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
