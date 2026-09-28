import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';

// SKELETON. Expanded by the main-process work unit (plan: docs/superpowers/plans/2026-09-28-foundation-plan.md, unit M).

// Dev and built runs share one data folder, and never touch the old app's %APPDATA%\designtools.
app.setPath('userData', join(app.getPath('appData'), 'Design Tools'));

const THEME_HEX = {
  dark: { page: '#060606', ground: '#131313', ink2: '#bebebe' },
  light: { page: '#e8e8e8', ground: '#d1d1d1', ink2: '#404040' },
} as const;

function createWindow() {
  const theme = 'dark' as const;
  const hex = THEME_HEX[theme];
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: hex.page,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: hex.ground, symbolColor: hex.ink2, height: 40 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--dt-theme=${theme}`],
    },
  });
  win.once('ready-to-show', () => win.show());
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) void win.loadURL(dev);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

Menu.setApplicationMenu(null);
void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
