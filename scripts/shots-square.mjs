// Screenshots of the Square and Wheel in each colour model: node scripts/shots-square.mjs <outDir>
// Launches the built app off-screen (--smoke-dir, throwaway data) and drives it only through CDP
// (page.mouse, page.evaluate, page.screenshot): no real input, no focus taken.
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
if (!outDir) throw new Error('usage: node scripts/shots-square.mjs <outDir>');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'dt-shots-square-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', `--smoke-dir=${dir}`, `--remote-debugging-port=${port}`, '--force-color-profile=srgb'], { cwd: repo, env, stdio: 'ignore' });
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await sleep(1500);

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const rectOf = (sel, text, within) => ev((sel, text, within) => {
  const scope = within ? document.querySelector(within) : document;
  const el = [...(scope?.querySelectorAll(sel) ?? [])].find((e) => e.getClientRects().length && (!text || (text.startsWith('~') ? e.textContent.includes(text.slice(1)) : e.textContent.trim() === text) || e.getAttribute('aria-label') === text));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel, text, within);
async function click(sel, text, within) {
  const b = await rectOf(sel, text, within);
  if (!b) { console.log('  (no such control:', sel, text ?? '', within ?? '', ')'); return false; }
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(250);
  return true;
}
const shot = async (name, clip) => { await sleep(500); if (process.env.DBG) console.log('before capture', await ev(() => !!document.querySelector('[role="dialog"][aria-label="Colour picker"]'))); await page.screenshot({ path: join(outDir, `${name}.png`), clip, captureBeyondViewport: false }); console.log(name); };
const pad = (b, p = 6) => (b ? { x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), width: b.width + 2 * p, height: Math.min(1080 - Math.max(0, b.y - p), b.height + 2 * p) } : undefined);
const MODELS = { hsb: 'HSB', hsl: 'HSL', rgb: 'RGB', cmyk: '≈CMYK', oklch: 'OKLCH' };
const LABELS = Object.values(MODELS);

/** where: a selector scoping the picker; the Select button is the one showing a model's name */
async function setModel(m, within) {
  const label = MODELS[m];
  const cur = await ev((within, labels) => {
    const b = [...document.querySelector(within).querySelectorAll('button')].find((x) => x.getClientRects().length && labels.includes(x.textContent.trim()) && x.getAttribute('aria-haspopup'));
    return b ? b.textContent.trim() : null;
  }, within, LABELS);
  if (cur === label) return;
  const at = await ev((within, labels) => {
    const b = [...document.querySelector(within).querySelectorAll('button')].find((x) => x.getClientRects().length && labels.includes(x.textContent.trim()) && x.getAttribute('aria-haspopup'));
    const r = b?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, within, LABELS);
  if (!at) { console.log('  (no model menu)', within); return; }
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  await sleep(300);
  if (process.env.DBG) { await shot('dbg-menu', undefined); console.log(await ev(() => [...document.querySelectorAll('[role=dialog],[role=listbox],[role=menu]')].map((e) => e.getAttribute('role') + ':' + e.getAttribute('aria-label')).join(' | '))); }
  const opt = await ev((label) => {
    const o = [...document.querySelectorAll('[role=option],[role=menuitem],[role=menuitemradio]')].find((e) => e.getClientRects().length && e.textContent.trim().startsWith(label));
    const r = o?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, label);
  if (!opt) { console.log('  (no option)', label); return; }
  await page.mouse.click(opt.x + opt.width / 2, opt.y + opt.height / 2);
  await sleep(400);
}
async function setLock(on, within) {
  const now = await ev((within) => [...document.querySelector(within).querySelectorAll('button[role=checkbox]')].find((b) => b.textContent.trim() === 'Hold value')?.getAttribute('aria-checked') === 'true', within);
  if (now !== on) await click('button[role=checkbox]', 'Hold value', within);
  await sleep(400);
}
const drag = async (sel, within, [x0, y0], [x1, y1]) => {
  const b = await rectOf(sel, null, within);
  if (!b) return;
  const p = (fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
  await page.mouse.move(...p(x0, y0)); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(...p(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8));
  await page.mouse.up(); await sleep(250);
};

try {
  await click('nav[aria-label=Tools] button,nav[aria-label=Tools] a', 'Design'); await sleep(800);
  await click('[data-tool="design"] button', '~Surprise me');
  await sleep(1500);
  const sw = await ev(() => { const c = document.querySelectorAll('[data-tool="design"] [role=listbox] > [data-swatch]')[3]?.getBoundingClientRect(); return c ? { x: c.x, y: c.y, width: c.width, height: c.height } : null; });
  if (sw) await page.mouse.click(sw.x + sw.width / 2, sw.y + sw.height * 0.4);
  await sleep(600);
  const sec = () => ev(() => { const s = [...document.querySelectorAll('[data-tool="design"] section')].find((x) => x.querySelector('h2')?.textContent === 'Colour picker'); s?.setAttribute('data-shot', ''); const r = s?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
  await sec();
  const IN = '[data-shot]';
  await click('[data-tool="design"] [role=radio]', 'Square');

  if (!process.env.ONLY_POP) {
  // the Design inspector: each model's Square, lock off then on
  for (const lock of [false, true]) {
    await setLock(lock, IN);
    for (const m of Object.keys(MODELS)) {
      await setModel(m, IN);
      await shot(`design-square-${m}-lock-${lock ? 'on' : 'off'}`, pad(await sec()));
    }
  }
  // a drag on each area, to show the marker somewhere other than where it started
  await setLock(false, IN);
  await setModel('hsl', IN);
  await drag('[data-plane]', IN, [0.5, 0.5], [0.85, 0.3]);
  await shot('design-square-hsl-dragged', pad(await sec()));
  await setModel('rgb', IN);
  await drag('[data-plane]', IN, [0.5, 0.5], [0.3, 0.2]);
  await shot('design-square-rgb-dragged', pad(await sec()));

  // the Wheel
  await click('[data-tool="design"] [role=radio]', 'Wheel');
  for (const lock of [false, true]) {
    await setLock(lock, IN);
    for (const m of ['hsb', 'hsl', 'rgb']) {
      await setModel(m, IN);
      await shot(`design-wheel-${m}-lock-${lock ? 'on' : 'off'}`, pad(await sec()));
    }
  }
  await setLock(false, IN);
  await click('[data-tool="design"] [role=radio]', 'Square');

  }
  // a ColorField popover (Halftone's chip): a capture closes it, so each shot opens it afresh, on settings made in Design
  const POP = '[role="dialog"][aria-label="Colour picker"]';
  const popShot = async (name) => {
    await click('nav[aria-label=Tools] button,nav[aria-label=Tools] a', 'Halftone'); await sleep(700);
    const chip = await ev(() => { const b = [...document.querySelectorAll('[data-tool="halftone"] button[aria-haspopup="dialog"]')].find((e) => e.getClientRects().length); const r = b?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
    if (!chip) return console.log('  (no chip)');
    await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await sleep(700);
    if (process.env.DBG) { console.log(JSON.stringify(chip), JSON.stringify(await rectOf(POP))); await shot('dbg-' + name, undefined); }
    await shot(name, pad(await rectOf(POP), 8));
    await page.keyboard.press('Escape'); await sleep(300);
  };
  const setDesign = async (style, model, lock) => {
    await click('nav[aria-label=Tools] button,nav[aria-label=Tools] a', 'Design'); await sleep(600);
    await ev(() => { const s = [...document.querySelectorAll('[data-tool="design"] section')].find((x) => x.querySelector('h2')?.textContent === 'Colour picker'); s?.setAttribute('data-shot', ''); });
    await click('[data-tool="design"] [role=radio]', style);
    await setModel(model, IN);
    await setLock(lock, IN);
  };
  for (const lock of [false, true]) {
    for (const m of Object.keys(MODELS)) {
      await setDesign('Square', m, lock);
      await popShot(`popover-square-${m}-lock-${lock ? 'on' : 'off'}`);
    }
  }
  for (const m of ['hsb', 'hsl']) {
    await setDesign('Wheel', m, false);
    await popShot(`popover-wheel-${m}`);
  }
  await setDesign('Square', 'hsb', false);
} catch (e) {
  console.log('ERR', e);
} finally {
  try { await ev(() => window.close()); } catch {}
  await sleep(500); done(); await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  await browser.disconnect?.();
  process.exit(0);
}
