// Screenshot harness: node scripts/shots.mjs <outDir> [--theme=dark|light] [--explore]
// Launches the built app off-screen (--smoke-dir, throwaway data), drives it only through CDP.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const require = createRequire(import.meta.url);
const puppeteer = require('D:/stuff/!projects/monolith-deck/node_modules/puppeteer-core');
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
const theme = (process.argv.find((a) => a.startsWith('--theme=')) ?? '--theme=dark').slice(8);
if (!outDir) throw new Error('usage: node scripts/shots.mjs <outDir> [--theme=dark|light]');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'dt-shots-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', `--smoke-dir=${dir}`, `--remote-debugging-port=${port}`], { cwd: repo, env, stdio: 'ignore' });
const done = () => { try { child.kill(); } catch {} };
process.on('exit', done);

let browser;
for (let i = 0; i < 60 && !browser; i++) {
  await sleep(500);
  try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); } catch {}
}
if (!browser) { done(); throw new Error('no CDP'); }
let page;
for (let i = 0; i < 40 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('http') || p.url().includes('dt')); await sleep(250); }
page ??= (await browser.pages())[0];
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await sleep(1500);

let n = 0;
const log = [];
async function shot(name) {
  await sleep(700);
  const f = `${name}.png`;
  await page.screenshot({ path: join(outDir, f) });
  log.push(f); console.log(f);
}
const ev = (fn, ...a) => page.evaluate(fn, ...a);
async function clickText(text, scope = 'body', sel = 'button,[role=tab],[role=radio],[role=menuitem],[role=option]') {
  const ok = await ev((text, scope, sel) => {
    const root = document.querySelector(scope) ?? document;
    const loose = text.startsWith('~'); if (loose) text = text.slice(1);
    const vis = (e) => e.getClientRects().length > 0;
    const el = [...root.querySelectorAll(sel)].find((e) => vis(e) && (e.textContent.trim().replace(/\s+/g, ' ').replace(/ ?[1-7L,]$/, '').endsWith(text) || (loose && e.textContent.includes(text)) || e.getAttribute('aria-label') === text));
    if (!el) return false;
    el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, text, scope, sel);
  if (!ok) { console.log('  (no such control:', text, ')'); return false; }
  await page.mouse.click(ok[0], ok[1]);
  return true;
}
async function setTheme(t) {
  // the real switch: Settings > Dark / Light, then back to Design
  await clickText('Settings', 'nav[aria-label=Tools]', 'button,a,[role=tab],[role=button]'); await sleep(800);
  await clickText(t === 'light' ? 'Light' : 'Dark', 'body', '[role=radio],[role=tab],button'); await sleep(800);
  await clickText('Design', 'nav[aria-label=Tools]', 'button,a,[role=tab],[role=button]'); await sleep(500);
}
/** drop a generated or fixture image on a tool via the app's global drop routing */
async function drop(tool, { name, mime, b64 }) {
  await ev(async ({ tool, name, mime, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type: mime }));
    const host = document.querySelector(`[data-tool="${tool}"]`);
    const r = host.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    host.dispatchEvent(new DragEvent('dragenter', o)); host.dispatchEvent(new DragEvent('dragover', o)); host.dispatchEvent(new DragEvent('drop', o));
  }, { tool, name, mime, b64 });
  await sleep(2500);
}
const fx = (f) => readFileSync(join(repo, 'test', 'fixtures', f));
// a busy synthetic "photo": gradients, blobs, a ramp and fine lines, so image tools have tone to work with
async function makePhoto() {
  const b64 = await ev(() => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 640; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 960, 640); bg.addColorStop(0, '#1b2a6b'); bg.addColorStop(0.5, '#e8603c'); bg.addColorStop(1, '#f6d977'); g.fillStyle = bg; g.fillRect(0, 0, 960, 640);
    const rg = g.createRadialGradient(300, 260, 10, 300, 260, 260); rg.addColorStop(0, '#fff'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, 960, 640);
    g.fillStyle = '#0d1a1a'; g.beginPath(); g.arc(660, 380, 170, 0, 7); g.fill();
    g.fillStyle = '#3fa796'; g.beginPath(); g.arc(700, 340, 110, 0, 7); g.fill();
    for (let i = 0; i < 16; i++) { g.fillStyle = `hsl(${i * 22} 70% ${20 + i * 3}%)`; g.fillRect(40 + i * 24, 520, 22, 90); }
    g.strokeStyle = '#000'; g.lineWidth = 2; for (let i = 0; i < 30; i++) { g.beginPath(); g.moveTo(0, 40 + i * 6); g.lineTo(960, 20 + i * 8); g.stroke(); }
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'sample-photo.png', mime: 'image/png', b64 };
}
if (theme === 'light') await setTheme(theme);
const photo = await makePhoto();
const four = { name: 'four-colours.png', mime: 'image/png', b64: fx('four-colours.png').toString('base64') };
const svgA = { name: 'svg-illustrator-a.svg', mime: 'image/svg+xml', b64: fx('svg-illustrator-a.svg').toString('base64') };
const svgB = { name: 'svg-illustrator-b.svg', mime: 'image/svg+xml', b64: fx('svg-illustrator-b.svg').toString('base64') };

const key = (k) => page.keyboard.press(k);
const NAMES = ['Design', 'Illustration', 'Pattern', 'Logo', 'Dither', 'Halftone', 'Post FX'];
const rail = async (i) => { await clickText(NAMES[i - 1], 'nav[aria-label=Tools]', 'button,a,[role=tab],[role=button]'); await sleep(900); };
const dumpTabs = () => ev(() => [...document.querySelectorAll('[data-tool] [role=tab], [data-tool] [role=radio], [data-tool] button')].filter((e) => e.getClientRects().length).map((e) => `${e.getAttribute('role') ?? 'btn'}:${(e.getAttribute('aria-label') || e.textContent).trim().replace(/\s+/g, ' ').slice(0, 40)}`));

try {
  if (process.argv.includes('--explore')) {
    for (let t = 1; t <= 7; t++) { await rail(t); await shot(`x${t}`); console.log(JSON.stringify(await dumpTabs())); }
  } else {
    await (await import('./shots-run.mjs')).run({ page, ev, shot, clickText, drop, rail, key, photo, four, svgA, svgB, sleep, dumpTabs, setTheme, theme });
  }
} finally {
  try { await ev(() => window.close()); } catch {}
  await sleep(500); done(); await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  await browser.disconnect?.();
  process.exit(0);
}
