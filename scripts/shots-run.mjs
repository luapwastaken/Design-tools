// The shot list, run by shots.mjs. Names: NN-tool-view.png
const T = (tool) => `[data-tool="${tool}"]`;
const NAV = 'nav[aria-label=Tools]';
const NAVSEL = 'button,a,[role=tab],[role=button]';
export async function run({ page, ev, shot, clickText, drop, rail, photo, four, svgA, svgB, sleep, key }) {
  const tab = (t, tool) => clickText(t, T(tool), '[role=tab],[role=radio],button');
  const click = (t, tool) => clickText(t, T(tool), 'button,[role=tab],[role=radio],[role=checkbox],[role=option]');
  const settle = () => sleep(1200);
  const visible = (tool) => ev((tool) => [...document.querySelectorAll(`[data-tool="${tool}"] [role=tab],[data-tool="${tool}"] [role=radio]`)].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)), tool);

  // 01 Colour: Design
  await rail(1);
  await shot('01-design-build-empty');
  for (const [t, f] of [['Harmony', 'harmony'], ['From image', 'from-image'], ['From logo', 'from-logo'], ['Gradient', 'gradient'], ['Paste', 'paste']]) {
    await tab('~' + t, 'design'); await sleep(600); await shot(`01-design-build-${f}-empty`);
  }
  await tab('~Generate', 'design');
  await click('Generate', 'design'); await settle(); // fills proposals
  await shot('01-design-build-generate-proposals');
  // add the proposals as swatches if the UI offers it
  await click('Add all', 'design');
  await sleep(800);
  await shot('01-design-build-swatches');
  await tab('Check', 'design'); await settle(); await shot('01-design-check');
  const rows = await ev(() => [...document.querySelectorAll('[data-tool="design"] [role=tablist][aria-orientation=vertical]')].find((l) => l.getClientRects().length)?.querySelectorAll('[role=tab]').length ?? 0);
  for (let i = 1; i < Math.min(rows, 4); i++) {
    await ev((i) => [...document.querySelectorAll('[data-tool="design"] [role=tablist][aria-orientation=vertical]')].find((l) => l.getClientRects().length).querySelectorAll('[role=tab]')[i].click(), i);
    await sleep(500); await shot(`01-design-check-row${i + 1}`);
  }
  await tab('Preview', 'design'); await settle(); await shot('01-design-preview');
  const pv = await visible('design');
  console.log('  design preview controls:', JSON.stringify(pv));
  let k = 2;
  for (const label of pv.filter((l) => /^(crop_square|donut_large|tune|change_history)$/.test(l))) {
    await clickText(label, T('design'), '[role=tab],[role=radio]'); await sleep(800); await shot(`01-design-inspector-${k++}-${{ crop_square: 'square', donut_large: 'wheel', tune: 'sliders', change_history: 'oklch-plan' }[label]}`);
  }
  await tab('Build', 'design');
  await drop('design', photo); await settle(); await shot('01-design-build-after-image-drop');

  // 02 Colour: Illustration
  await rail(2); await shot('02-illustration-light-empty');
  await click('Add a base colour', 'illustration'); await settle(); await shot('02-illustration-light-base');
  await click('All ramps', 'illustration'); await settle(); await shot('02-illustration-light-all-ramps'); await click('Shapes', 'illustration');
  await tab('Check', 'illustration'); await settle(); await shot('02-illustration-check');
  await tab('Paint', 'illustration'); await settle(); await shot('02-illustration-paint');
  const r = await ev(() => document.querySelector('[data-tool="illustration"] canvas[aria-label^="Painting"]')?.getBoundingClientRect().toJSON());
  if (r) {
    await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.4); await page.mouse.down();
    for (let i = 0; i <= 30; i++) await page.mouse.move(r.x + r.width * (0.2 + i * 0.02), r.y + r.height * (0.4 + Math.sin(i / 4) * 0.1));
    await page.mouse.up(); await sleep(1200); await shot('02-illustration-paint-stroked');
  }

  // 03 Pattern
  await rail(3); await shot('03-pattern-default');
  for (const [lbl, f] of [['Half-drop', 'halfdrop'], ['Brick', 'brick'], ['Scatter', 'scatter']]) { await click(lbl, 'pattern'); await sleep(900); await shot(`03-pattern-${f}`); }
  await click('Grid', 'pattern'); await click('Tile seams', 'pattern'); await sleep(700); await shot('03-pattern-seams');
  await click('Tile seams', 'pattern'); await click('Surprise me', 'pattern'); await settle(); await shot('03-pattern-surprise');
  await click('Export', 'pattern'); await sleep(500); await shot('03-pattern-export-menu'); await key('Escape'); await sleep(300);

  // 04 Logo
  await rail(4); await shot('04-logo-empty');
  await drop('logo', svgA); await settle(); await shot('04-logo-edit-one-part');
  await drop('logo', svgB); await settle(); await shot('04-logo-edit-two-parts');
  await click('Sheet', 'logo'); await settle(); await shot('04-logo-sheet');
  await click('Edit', 'logo'); await sleep(500);

  // 05 Dither
  await rail(5); await shot('05-dither-empty');
  await drop('dither', photo); await settle(); await sleep(1500); await shot('05-dither-result');
  await click('Original', 'dither'); await sleep(800); await shot('05-dither-original');
  await click('Result', 'dither');
  for (const [l, f] of [['Game Boy', 'gameboy'], ['Risograph duo', 'riso'], ['Newsprint', 'newsprint']]) { await click(l, 'dither'); await sleep(1500); await shot(`05-dither-look-${f}`); }

  // 06 Halftone
  await rail(6); await shot('06-halftone-empty');
  await drop('halftone', photo); await settle(); await sleep(2000); await shot('06-halftone-result');
  await click('Original', 'halftone'); await sleep(800); await shot('06-halftone-original');
  await click('Separations', 'halftone'); await sleep(1500); await shot('06-halftone-separations');
  await click('Result', 'halftone');
  for (const [l, f] of [['Line', 'line'], ['Stochastic (FM)', 'fm'], ['Spot inks', 'spot']]) { await click(l, 'halftone'); await sleep(1800); await shot(`06-halftone-${f}`); }

  // 07 Post FX
  await rail(7); await shot('07-postfx-empty');
  await drop('postfx', photo); await settle(); await shot('07-postfx-loaded');
  await click('Add an effect', 'postfx'); await sleep(800); await shot('07-postfx-add-effect-picker');
  await key('Escape'); await sleep(300);
  await click('Presets', 'postfx'); await sleep(500); await shot('07-postfx-presets-open');
  await click('~VHS tape', 'postfx'); await sleep(1500); await click('Presets', 'postfx'); await sleep(500); await shot('07-postfx-preset-vhs');
  await click('Loop', 'postfx'); await sleep(500); await shot('07-postfx-loop-open'); await click('Loop', 'postfx');
  await click('Export', 'postfx'); await sleep(500); await shot('07-postfx-export-menu'); await key('Escape'); await sleep(300);
  await click('Split', 'postfx'); await sleep(1200); await shot('07-postfx-split');
  await click('Original', 'postfx'); await sleep(800); await shot('07-postfx-original');
  await click('Result', 'postfx');

  // Settings and Library
  await clickText('Settings', NAV, NAVSEL); await settle(); await shot('08-settings');
  const sets = await ev(() => [...document.querySelectorAll('[role=tab],[role=radio]')].filter((e) => e.getClientRects().length && !e.closest('[data-tool]')).map((e) => e.textContent.trim().slice(0, 24)));
  console.log('  settings controls:', JSON.stringify(sets));
  await clickText('Design', NAV, NAVSEL); await sleep(600);
  await clickText('Library', NAV, NAVSEL); await settle(); await shot('09-library-open'); // closed on first run
  await clickText('Library', NAV, NAVSEL); await settle(); await shot('09-library-closed');
}
