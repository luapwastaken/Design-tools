// Screenshots of the OKLCH picker: node scripts/shots-picker.mjs <outDir> [--explore]
// Launches the built app off-screen (--smoke-dir, throwaway data) and drives it only through CDP
// (page.mouse, page.keyboard, page.evaluate, page.screenshot): no real input, no focus taken.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const require = createRequire(import.meta.url);
const puppeteer = require('D:/stuff/!projects/monolith-deck/node_modules/puppeteer-core');
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node scripts/shots-picker.mjs <outDir>');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'dt-shots-picker-'));
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
page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && console.log('  console.error:', m.text().slice(0, 300)));
const cdp = await page.createCDPSession();
const narrow = process.argv.includes('--narrow');
const [W, H] = narrow ? [Number(process.env.NARROW_W ?? 1180), 860] : [1920, 1080];
const prefix = narrow ? 'narrow-' : '';
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: Number(process.env.DPR ?? 1), mobile: false });
await sleep(1500);

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const shot = async (name, clip) => { await sleep(500); await page.screenshot({ path: join(outDir, `${prefix}${name}.png`), clip }); console.log(name); };
/** the box of the first visible element matching `sel` (text filter optional) */
const box = (sel, text) => ev((sel, text) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length && (!text || (text.startsWith('~') ? e.textContent.includes(text.slice(1)) : e.textContent.trim() === text) || e.getAttribute('aria-label') === text));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel, text);
async function click(sel, text) {
  const b = await box(sel, text);
  if (!b) { console.log('  (no such control:', sel, text ?? '', ')'); return false; }
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  return true;
}
const at = (b, fx, fy = 0.5) => [b.x + b.width * fx, b.y + b.height * fy];
async function drag(b, [x0, y0], [x1, y1], steps = 12) {
  await page.mouse.move(...at(b, x0, y0)); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(...at(b, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps));
  await page.mouse.up(); await sleep(200);
}
/** the value lock, through its button */
async function setLock(on) {
  const now = await ev(() => document.querySelector('[data-tool="design"] button[aria-label="Value lock"]')?.getAttribute('aria-pressed') === 'true');
  if (now !== on) await click('[data-tool="design"] button', 'Value lock');
  await sleep(500);
}

try {
  // Design: a generated palette, one swatch selected, the OKLCH style
  await click('nav[aria-label=Tools] button,nav[aria-label=Tools] a', 'Design'); await sleep(800);
  await click('[data-tool="design"] button', '~Generate');
  await sleep(1500);
  const sw = await ev(() => { const c = document.querySelectorAll('[data-tool="design"] [role=listbox] > [data-swatch]')[3]?.getBoundingClientRect(); return c ? { x: c.x, y: c.y, width: c.width, height: c.height } : null; });
  if (sw) await page.mouse.click(...at(sw, 0.5, 0.4));
  await sleep(600);
  await click('[data-tool="design"] [role=radio]', 'OKLCH'); await sleep(800);
  const section = () => box('[data-tool="design"] section[aria-label="Colour picker"], [data-tool="design"] section', null);
  const section2 = async () => ev(() => { const s = [...document.querySelectorAll('[data-tool="design"] section')].find((x) => x.querySelector('h2')?.textContent === 'Colour picker'); const r = s?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
  const clipOf = async (pad = 6) => { const b = await section2(); return b ? { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: Math.min(b.height + 2 * pad, H - Math.max(0, b.y - pad)) } : undefined; };
  const plane = () => box('[data-tool="design"] [data-plane]');

  if (process.argv.includes('--explore')) {
    await ev(() => { const i = document.querySelector('[data-tool="design"] input[aria-label="Hex"]'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '#808080'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    await sleep(800);
    console.log(JSON.stringify(await ev(() => [...document.querySelectorAll('[data-tool="design"] [data-track]')].map((t) => [t.dataset.track, t.querySelectorAll('canvas').length, t.getBoundingClientRect().width, t.firstElementChild.getBoundingClientRect().width]))));
    await shot('explore', undefined);
    throw new Error('explored');
  }

  // DPR=2: the page reports a device pixel ratio of 2, so the planes and strips draw at twice the pixels (the shot itself stays 1x)
  if (process.env.DPR) await ev((d) => Object.defineProperty(window, 'devicePixelRatio', { value: Number(d), configurable: true }), process.env.DPR);
  // each plane, lock off then on
  for (const lock of narrow ? [] : [false, true]) {
    await setLock(lock);
    for (const [id, label] of [['lc', 'L×C'], ['ch', 'C×H'], ['hl', 'H×L']]) {
      await click('[data-tool="design"] [role=radio]', label); await sleep(900);
      const b = await plane();
      if (b && lock && id !== 'ch') await drag(b, [0.3, 0.3], [0.6, 0.55]);
      else if (b) await drag(b, [0.25, 0.65], [0.6, 0.35]);
      await shot(`${lock ? '02' : '01'}-plane-${id}-lock-${lock ? 'on' : 'off'}`, await clipOf());
    }
  }
  // the strips at a grey, the Max button, the narrow inspector
  await setLock(false);
  await click('[data-tool="design"] [role=radio]', 'C×H'); await sleep(500);
  await ev(() => { const i = document.querySelector('[data-tool="design"] input[aria-label="Hex"]'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'oklch(0.62 0.004 250)'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await sleep(700); await shot('03-grey-hue-strip', await clipOf());
  await ev(() => { const i = document.querySelector('[data-tool="design"] input[aria-label="Hex"]'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'oklch(0.7 0.33 150)'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await sleep(700); await shot('04-code-field-oklch-paste', await clipOf());
  // Copy as menu
  await click('[data-tool="design"] button', 'Copy as'); await sleep(700);
  await shot('05-copy-as-menu', undefined);
  await page.keyboard.press('Escape'); await sleep(300);
  if (narrow) { await ev(() => [...document.querySelectorAll('[data-tool="design"] section h2')].find((h) => h.textContent === 'Colour picker')?.scrollIntoView({ block: 'start' })); await sleep(300); await shot('06-design-oklch', await clipOf()); }

  // Illustration's Colour picker: the whole Picker (Gamut block, hex row), with a colour outside sRGB
  await click('nav[aria-label=Tools] button,nav[aria-label=Tools] a', 'Illustration'); await sleep(900);
  await click('[data-tool="illustration"] button', 'Skin'); await sleep(500);
  await click('[data-tool="illustration"] button', '~Add base colour'); await sleep(900);
  const sec = () => ev(() => { const s = [...document.querySelectorAll('[data-tool="illustration"] section')].find((x) => x.querySelector('h2')?.textContent === 'Colour picker'); const r = s?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
  const paste = (text) => ev((text) => { const i = [...document.querySelectorAll('[data-tool="illustration"] input[aria-label="Hex"]')].find((e) => e.getClientRects().length); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, text); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }, text);
  await click('[data-tool="illustration"] [role=radio]', 'OKLCH plane'); await sleep(700);
  await paste('oklch(0.7 0.33 150)'); await sleep(800);
  const top = () => ev(() => { for (let e = document.querySelector('[data-tool="illustration"] [data-plane]'); e; e = e.parentElement) e.scrollTop = 0; });
  const clip2 = async () => { await top(); await sleep(300); const c = await sec(); return c ? { x: Math.max(0, c.x - 6), y: Math.max(0, c.y - 6), width: c.width + 12, height: Math.min(H - Math.max(0, c.y - 6), c.height + 12) } : undefined; };
  await shot('07-out-of-gamut', await clip2());
  console.log('  illustration picker width', (await sec())?.width);
  if (narrow) {
    await paste('oklch(0.62 0.14 145)'); await sleep(500);
    await click('[data-tool="illustration"] button', 'Value lock'); await sleep(500);
    await click('[data-tool="illustration"] [role=radio]', 'C×H'); await sleep(900);
    await shot('08-held-plane-in-the-inspector', await clip2());
  }
} finally {
  try { await ev(() => window.close()); } catch {}
  await sleep(500); done(); await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  await browser.disconnect?.();
  process.exit(0);
}
