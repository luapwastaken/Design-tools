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
})
