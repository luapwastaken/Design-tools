import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Bridge } from '../shared/api.ts';
import type { Theme } from '../shared/types.ts';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const initialTheme: Theme = arg('dt-theme') === 'light' ? 'light' : 'dark';

// Set the theme before first paint so a light-theme start never flashes dark. A sandboxed preload
// runs before <html> exists, so wait for the element to be inserted (still before any paint).
function applyTheme() {
  if (!document.documentElement) return false;
  document.documentElement.dataset.theme = initialTheme;
  return true;
}
if (!applyTheme()) {
  const mo = new MutationObserver(() => applyTheme() && mo.disconnect());
  mo.observe(document, { childList: true });
}

const strip = (e: unknown) => {
  // ipcRenderer wraps main-process errors as "Error invoking remote method 'x': Error: message"
  const msg = e instanceof Error ? e.message : String(e);
  throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
};

const bridge: Bridge = {
  invoke: ((name: string, ...args: unknown[]) => ipcRenderer.invoke(name, ...args).catch(strip)) as Bridge['invoke'],
  on: (name, fn) => {
    const listener = (_e: unknown, payload: Parameters<typeof fn>[0]) => fn(payload);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.off(name, listener);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  initialTheme,
  smoke: process.argv.includes('--dt-smoke'),
};

contextBridge.exposeInMainWorld('api', bridge);
