const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  saveSession:  (key, data)                => ipcRenderer.invoke('session:save',    { key, data }),
  loadSession:  (key)                      => ipcRenderer.invoke('session:load',    { key }),
  pickFolder:   ()                         => ipcRenderer.invoke('dialog:pickFolder'),

  // Unsaved-changes flag — drives the warn-before-close prompt in main.js
  setUnsavedChanges: (flag)                => ipcRenderer.send('app:unsavedChanges', !!flag),
  writeFile:    (filePath, data, encoding) => ipcRenderer.invoke('fs:writeFile',   { filePath, data, encoding }),

  // Screen colour picker — multi-monitor live preview
  eyedropperSources:  () => ipcRenderer.invoke('eyedropper:sources'),
  eyedropperCursor:   () => ipcRenderer.invoke('eyedropper:cursor'),
  eyedropperDisplays: () => ipcRenderer.invoke('eyedropper:displays'),

  // cobalt batch downloader — drives the embedded cobalt.tools webview and
  // captures its downloads into a chosen folder.
  cobaltSetDownloadDir: (dir) => ipcRenderer.invoke('cobalt:setDownloadDir', dir),
  soundcloudExpand: (url) => ipcRenderer.invoke('soundcloud:expand', url),
  onCobaltDownload: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('cobalt:download-event', handler)
    return () => ipcRenderer.removeListener('cobalt:download-event', handler)
  },
})
