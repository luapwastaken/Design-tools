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
  await shot('01-design-empty');
  await click('Add', 'design'); await sleep(500); await shot('01-design-empty-add-menu');
  await key('Escape'); await sleep(300);
  // Generate on an empty palette makes it in one step; a column is selected by clicking it
  await click('~Generate', 'design'); await settle();
  const column = (n) => ev((n) => { const c = document.querySelectorAll('[data-tool="design"] [role=listbox] > [data-swatch]')[n]; const r = c?.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + r.height * 0.45] : null; }, n);
  const at = await column(3);
  if (at) { await page.mouse.move(at[0], at[1]); await page.mouse.click(at[0], at[1]); }
  await settle(); await shot('01-design-artboard-selected');
  // the "+" on a seam shows while the pointer is on it
  const seam = await ev(() => { const c = document.querySelectorAll('[data-tool="design"] [role=listbox] > [data-swatch]')[1]; const r = c?.getBoundingClientRect(); return r ? [r.right, r.y + r.height / 2] : null; });
  if (seam) { await page.mouse.move(seam[0] - 3, seam[1]); await sleep(200); await shot('01-design-seam'); await page.mouse.move(5, 5); }
  // + Add: the menu, then Start from one colour as a popover, then its proposals on the artboard
  await click('Add', 'design'); await sleep(500); await shot('01-design-add-menu');
  await clickText('~Start from one colour', 'body', '[role=menuitem]'); await sleep(600); await shot('01-design-add-popover');
  await clickText('~Triad', 'body', '[role=dialog] [role=listitem]'); await settle(); await shot('01-design-proposals');
  await click('Keep all', 'design'); await sleep(800);
  // the Checks dock starts folded to its chips; open it, then Print's Inks across the whole dock, and back
  await shot('01-design-checks-collapsed');
  await click('Open the checks', 'design'); await sleep(700);
  await shot('01-design-checks-dock');
  await click('Inks', 'design'); await settle(); await shot('01-design-checks-inks');
  await click('Back to the checks', 'design'); await sleep(500);
  // In use, and the Simulate filter on the artboard
  await click('In use', 'design'); await settle(); await shot('01-design-in-use');
  await click('Swatches', 'design'); await sleep(500);
  await clickText('Normal', 'body', '[aria-haspopup=listbox]'); await sleep(400);
  await clickText('Deutan', 'body', '[role=option]'); await settle(); await shot('01-design-simulate');
  await clickText('Deutan', 'body', '[aria-haspopup=listbox]'); await sleep(400);
  await clickText('Normal', 'body', '[role=option]'); await sleep(500);
  // inspector: the app-wide picker style switch
  for (const label of ['Wheel', 'Sliders', 'OKLCH plane', 'Square']) {
    await clickText(label, T('design'), '[role=radio]'); await sleep(700);
    if (label !== 'Square') await shot(`01-design-inspector-${label.toLowerCase().replace(' ', '-')}`);
  }
  await drop('design', photo); await settle(); await shot('01-design-after-image-drop');
  await click('Discard', 'design'); await sleep(500);

  await illustrationShots({ page, ev, shot, clickText, rail, key, sleep });

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
  await ev(() => document.querySelector('[data-tool="logo"] [data-artboard="stacked"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(700); await shot('04-logo-selected-stacked');
  await click('Black', 'logo'); await sleep(900); await shot('04-logo-black');
  await click('Original', 'logo'); await sleep(500);
  await ev(() => document.querySelector('[data-tool="logo"] [data-artboard="horizontal"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(500);
  await click('Sheet', 'logo'); await settle(); await shot('04-logo-sheet');
  await click('Sheet', 'logo'); await sleep(500);

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

/** 02 Colour: Illustration: the empty state, then each mode with five ramps, and a stroke on the paper */
export async function illustrationShots({ page, ev, shot, clickText, rail, key, sleep }) {
  const click = (t, extra = '') => clickText(t, T('illustration'), 'button,[role=tab],[role=radio],[role=checkbox],[role=option]' + extra);
  const mode = async (name) => { await clickText('~' + name, T('illustration'), '[role=radio]'); await sleep(1200); };
  await rail(2); await shot('02-illustration-empty');
  await click('Skin'); await sleep(500);
  for (let i = 0; i < 4; i++) { await click('~Add base'); await sleep(400); }
  await shot('02-illustration-ramps');
  await mode('Light'); await shot('02-illustration-light');
  await click('All ramps'); await sleep(900); await shot('02-illustration-light-all-ramps'); await click('This ramp'); await click('Cube'); await sleep(600); await shot('02-illustration-light-cube'); await click('Sphere');
  await mode('Check'); await shot('02-illustration-check');
  await mode('Paint'); await sleep(1500); await shot('02-illustration-paint');
  const r = await ev(() => document.querySelector('[data-tool="illustration"] canvas[aria-label^="Painting"]')?.getBoundingClientRect().toJSON());
  if (r) {
    await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.4); await page.mouse.down();
    for (let i = 0; i <= 30; i++) await page.mouse.move(r.x + r.width * (0.2 + i * 0.02), r.y + r.height * (0.4 + Math.sin(i / 4) * 0.1));
    await page.mouse.up(); await sleep(1200); await shot('02-illustration-paint-stroked');
  }
  await mode('Ramps');
}
