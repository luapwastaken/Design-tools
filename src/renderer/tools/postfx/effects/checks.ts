// GPU checks for the effects (plan unit F) that node --test can't run: no moving effect flickers
// (mid-grey and a barred card, at its defaults and at the worst its settings allow, in the shortest
// loop, the default one and a slow one: mean light never changes more than 2 % of mid-grey's between
// frames, the wrap from the last frame to the first included), loops are exact (the step across the
// wrap is no bigger than any other, and continuous motion is continuous up to it), half floats between
// passes, alpha kept, datamosh the same every time, and a half-scale preview as bright as the export.
// They run in the page (allChecks(), about 6 s): the smoke run, or a harness over CDP.
import { hexToOklch, linearRgb } from '../../../../shared/color/index.ts';
import { defaultsOf, EFFECTS } from './index.ts';
import { leadIn, runIn } from '../doc.ts';
import { Stack, type StackLayer } from './stack.ts';
import type { Texture } from '../../../lib/gpu/index.ts';
import type { EffectId, ParamValue } from './types.ts';

export type Check = { name: string; ok: boolean; detail: string };

const FRAMES = 60;
/** the most the light may change from one frame to the next, as a share of mid-grey's, at 25 frames a second and up */
const MAX_STEP = 0.02;

const hex2 = (v: number) => v.toString(16).padStart(2, '0');
// each byte decoded to light through shared/color
const LIGHT = Float64Array.from({ length: 256 }, (_, v) => linearRgb(hexToOklch(hex2(v).repeat(3)))[0]);

/** mean relative luminance (the WCAG weights on linear light) of opaque RGBA bytes */
function meanLuminance(px: Uint8Array): number {
  let y = 0;
  for (let i = 0; i < px.length; i += 4) y += 0.2126 * LIGHT[px[i]] + 0.7152 * LIGHT[px[i + 1]] + 0.0722 * LIGHT[px[i + 2]];
  return y / (px.length / 4);
}

/** mean absolute difference, in 8-bit levels */
function meanDiff(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const maxDiff = (a: Uint8Array, b: Uint8Array, channel = -1) => a.reduce((m, v, i) => (channel < 0 || i % 4 === channel ? Math.max(m, Math.abs(v - b[i])) : m), 0);

type Card = (x: number, y: number) => [number, number, number, number];
const GREY: Card = () => [128, 128, 128, 255];
// ramps, a checker and soft rings: detail for displacements to move
const TEXTURED: Card = (x, y) => {
  const check = ((x >> 4) + (y >> 4)) & 1 ? 40 : 0;
  const ring = 60 * (0.5 + 0.5 * Math.cos(Math.hypot(x - 128, y - 128) / 6));
  return [Math.min(255, x + check), Math.min(255, y + check), Math.min(255, ring + check * 2), 255];
};

// stripes and soft rings with no ramp: moving them about keeps the same light (a ramp's would change as it shifts)
const BARS: Card = (x, y) => {
  const bar = (x >> 5) & 1 ? 190 : 70;
  const ring = 60 * (0.5 + 0.5 * Math.cos(Math.hypot(x - 128, y - 128) / 6));
  return [bar, (bar + ring) / 1.5, 255 - bar + ring / 2, 255];
};
/** a card this wide is a 1920 px image seen small: effects' px settings are scaled to it, as a preview does */
const CARD = 256;
const CARD_SCALE = CARD / 1920;

function card(stack: Stack, w: number, h: number, fn: Card): Texture {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x, y).forEach((v, c) => (data[(y * w + x) * 4 + c] = v / 255));
  return stack.g.texture({ width: w, height: h, data }, 'rgba16f');
}

const layer = (effect: EffectId, params: Record<string, ParamValue> = {}, more: Partial<StackLayer> = {}): StackLayer => ({
  id: `${effect}-${Math.random()}`,
  effect,
  on: true,
  opacity: 1,
  blend: 'normal',
  params: { ...defaultsOf(effect), ...params },
  ...more,
});

/** the setting each moving effect's pace comes from */
const CLOCK: Record<string, string> = { grain: 'boil', vhs: 'speed', glitch: 'changes', wave: 'cycles', 'light-leak': 'cycles' };

/** the effects whose motion has no stepped clock in it (VHS and grain re-seed their noise on a clock) */
const CONTINUOUS = ['light-leak', 'wave'];

/** the moving effects at their defaults, with their clock at its fastest, and at the worst their settings allow: every number at its most, or at its least with the clock at its fastest */
function movingCases(): { name: string; layer: StackLayer }[] {
  return EFFECTS.filter((e) => e.moving).flatMap((e) => {
    const key = CLOCK[e.id];
    const nums = e.params.flatMap((p) => (p.kind === 'number' ? [p] : []));
    const fastest = nums.find((p) => p.key === key)!.max;
    return [
      { name: `${e.id} (defaults)`, layer: layer(e.id) },
      { name: `${e.id} (${key} ${fastest})`, layer: layer(e.id, { [key]: fastest }) },
      { name: `${e.id} (every setting at most)`, layer: layer(e.id, Object.fromEntries(nums.map((p) => [p.key, p.max]))) },
      { name: `${e.id} (every setting at least, ${key} ${fastest})`, layer: layer(e.id, Object.fromEntries(nums.map((p) => [p.key, p.key === key ? fastest : p.min]))) },
    ];
  });
}

/** the loops the Loop settings allow, shortest and fastest first, then the default, then a slow one: seconds and frames a second */
const LOOPS: [number, number][] = [[0.5, 50], [2, 25], [4, 12]];

/** a frame's limit: 2 % at 25 frames a second and up; slower than that the same a second, which is what looks like flicker */
const stepLimit = (fps: number) => MAX_STEP * Math.max(1, 25 / fps);

const frames = (stack: Stack, src: Texture, l: StackLayer, n = FRAMES, o: { seconds?: number; scale?: number } = {}) => Array.from({ length: n }, (_, i) => stack.bytes(stack.render(src, [l], { t: i / n, ...o })));

export function flickerChecks(): Check[] {
  const stack = new Stack('post fx checks');
  const out: Check[] = [];
  try {
    const mid = LIGHT[128];
    for (const [cardName, fn] of [['mid-grey', GREY], ['bars', BARS]] as const) {
      const src = card(stack, CARD, CARD, fn);
      for (const c of movingCases()) {
        for (const [seconds, fps] of LOOPS) {
          const n = Math.round(seconds * fps);
          const lum = frames(stack, src, c.layer, n, { seconds, scale: CARD_SCALE }).map(meanLuminance);
          let worst = 0;
          for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(lum[(i + 1) % n] - lum[i]) / mid);
          out.push({ name: `no flicker: ${c.name} on ${cardName}, ${seconds} s at ${fps} fps`, ok: worst < stepLimit(fps), detail: `largest frame-to-frame change ${(worst * 100).toFixed(3)} % of mid-grey (limit ${(stepLimit(fps) * 100).toFixed(1)} %)` });
        }
      }
    }
  } finally {
    stack.release();
  }
  return out;
}

export function loopChecks(): Check[] {
  const a = new Stack('post fx checks a');
  const b = new Stack('post fx checks b');
  const out: Check[] = [];
  try {
    const srcA = card(a, 256, 256, TEXTURED);
    const srcB = card(b, 256, 256, TEXTURED);
    for (const c of movingCases().filter((x) => x.name.endsWith('(defaults)'))) {
      // continuous motion has no step at the wrap: a hair before the end draws what the start does (stepped clocks, grain and glitch, change at the wrap by design)
      if (CONTINUOUS.includes(c.layer.effect)) {
        const first = a.bytes(a.render(srcA, [c.layer], { t: 0 }));
        const almost = b.bytes(b.render(srcB, [c.layer], { t: 1 - 1e-4 }));
        const gap = meanDiff(first, almost);
        out.push({ name: `exact loop: ${c.name}`, ok: gap < 0.05, detail: `a hair before the end differs from the start by ${gap.toFixed(4)} levels on average` });
      }
      const f = frames(a, srcA, c.layer);
      let step = 0;
      for (let i = 1; i < FRAMES; i++) step = Math.max(step, meanDiff(f[i - 1], f[i]));
      const seam = meanDiff(f[FRAMES - 1], f[0]);
      out.push({ name: `no jump at the wrap: ${c.name}`, ok: seam <= step * 1.5 + 0.05, detail: `last to first ${seam.toFixed(3)} levels; largest other step ${step.toFixed(3)}` });
    }
  } finally {
    a.release();
    b.release();
  }
  return out;
}

export function pipelineChecks(): Check[] {
  const stack = new Stack('post fx checks');
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });
  try {
    // every effect draws, at its defaults, with nothing that isn't a number and alpha in range
    const colours = card(stack, 320, 180, TEXTURED);
    for (const e of EFFECTS) {
      const began = performance.now();
      const res = stack.render(colours, [layer(e.id)], { frame: e.videoOnly ? 0 : null });
      const f = stack.g.read(res);
      let bad = 0;
      for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i]) || (i % 4 === 3 && (f[i] < 0 || f[i] > 1))) bad++;
      add(`draws: ${e.id}`, bad === 0, bad ? `${bad} values not finite or alpha out of range` : `ok in ${(performance.now() - began).toFixed(1)} ms`);
    }

    // half floats between passes: a quarter the gain, then four times it, gives the ramp back
    const ramp = card(stack, 256, 8, (x) => [x, x, x, 255]);
    const rampBytes = stack.bytes(ramp);
    const down = stack.bytes(stack.render(ramp, [layer('grade', { gain: 25 }), layer('grade', { gain: 400 })]));
    add('16-bit between passes', maxDiff(rampBytes, down) <= 1, `a ramp at 25 % gain then 400 % comes back within ${maxDiff(rampBytes, down)} level (8 bits would lose 3 of every 4 levels)`);
    const bright = card(stack, 8, 8, () => [204, 204, 204, 255]);
    const back = stack.bytes(stack.render(bright, [layer('grade', { gain: 200 }), layer('grade', { gain: 50 })]));
    add('headroom past white', Math.abs(back[0] - 204) <= 1, `80 % grey doubled, then halved: ${back[0]} (clamping between passes would give 128)`);

    // alpha as it was, and a blur that doesn't darken a clear edge
    const clear = card(stack, 256, 8, (x) => [200, 90, 40, x]);
    const clearBytes = stack.bytes(clear);
    const graded = stack.bytes(stack.render(clear, [layer('grade', { saturation: 150 })]));
    add('alpha kept', maxDiff(clearBytes, graded, 3) === 0, `alpha differs by ${maxDiff(clearBytes, graded, 3)} levels after a grade`);
    const disc = card(stack, 96, 96, (x, y) => (Math.hypot(x - 48, y - 48) < 24 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const blurred = stack.bytes(stack.render(disc, [layer('gaussian', { radius: 6 })]));
    let darkest = 255;
    for (let i = 0; i < blurred.length; i += 4) if (blurred[i + 3] > 12) darkest = Math.min(darkest, blurred[i]);
    add('blur keeps clear edges clean', darkest >= 250, `darkest colour under any visible alpha: ${darkest} (a straight-alpha blur would fall toward 0)`);

    // blend modes and opacity: 50 % grey under a grade to about 25 %
    const mid = card(stack, 4, 4, () => [128, 128, 128, 255]);
    const quarter = stack.bytes(stack.render(mid, [layer('grade', { gain: 50 })]))[0] / 255;
    const b = 128 / 255;
    const want: [string, Partial<StackLayer>, number][] = [
      ['multiply', { blend: 'multiply' }, b * quarter],
      ['screen', { blend: 'screen' }, 1 - (1 - b) * (1 - quarter)],
      ['overlay', { blend: 'overlay' }, 1 - 2 * (1 - b) * (1 - quarter)],
      ['add', { blend: 'add' }, b + quarter],
      ['normal at 50 %', { opacity: 0.5 }, (b + quarter) / 2],
    ];
    for (const [name, more, v] of want) {
      const got = stack.bytes(stack.render(mid, [layer('grade', { gain: 50 }, more)]))[0];
      add(`blend: ${name}`, Math.abs(got - v * 255) <= 1, `${got}, expected ${(v * 255).toFixed(1)}`);
    }
  } finally {
    stack.release();
  }
  return out;
}

export function datamoshChecks(): Check[] {
  const a = new Stack('post fx checks a');
  const b = new Stack('post fx checks b');
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });
  try {
    const mosh = layer('datamosh', { refresh: 0 });
    const still = card(a, 64, 64, TEXTURED);
    add('datamosh is skipped on a still', same(a.bytes(a.render(still, [mosh])), a.bytes(still)), 'frame null: the input, untouched');

    // a textured square moving 4 px a frame across a ramp
    const frame = (s: Stack, i: number) => card(s, 128, 96, (x, y) => (x >= 20 + i * 4 && x < 60 + i * 4 && y >= 28 && y < 68 ? TEXTURED(x * 3, y * 3) : [x, 90, 255 - x, 255]));
    let identical = true;
    let redraw = true;
    let last: Uint8Array | null = null;
    let plain: Uint8Array | null = null;
    for (let i = 0; i < 10; i++) {
      const [fa, fb] = [frame(a, i), frame(b, i)];
      const ra = a.bytes(a.render(fa, [mosh], { frame: i }));
      const rb = b.bytes(b.render(fb, [mosh], { frame: i }));
      identical &&= same(ra, rb);
      if (i === 5) redraw = same(ra, a.bytes(a.render(fa, [mosh], { frame: 5 })));
      last = ra;
      plain = a.bytes(fa);
      fa.release();
      fb.release();
    }
    add('datamosh is the same every time', identical, 'two stacks from frame 0 to 9 agree byte for byte');
    add('datamosh redraws a frame without advancing', redraw, 'frame 5 drawn twice is the same');
    add('datamosh moshes', !!last && !!plain && meanDiff(last, plain) > 1, `frame 9 differs from its plain frame by ${last && plain ? meanDiff(last, plain).toFixed(2) : '?'} levels on average`);

    // what the tool reads to tell a frame that has its run-in from one that began clean (doc.ts leadIn)
    const mem = a.memory(mosh.id);
    add('datamosh remembers its run of frames', mem?.f === 9 && mem.run === 9 && leadIn(9, [mem]).length === 0 && leadIn(20, [mem]).length === 20, `after frames 0 to 9: ${JSON.stringify(mem)}`);

    // a frame reached by a seek is drawn after its run-in, and is the picture playing from the start gives it
    let seek: Uint8Array | null = null;
    for (const i of [...runIn(9), 9]) {
      const f = frame(b, i);
      const r = b.bytes(b.render(f, [mosh], { frame: i }));
      f.release();
      if (i === 9) seek = r;
    }
    add('datamosh drawn after its run-in is the frame played to', !!seek && !!last && same(seek, last), 'frame 9 after the frames before it agrees with frames 0 to 9 in order, byte for byte');
  } finally {
    a.release();
    b.release();
  }
  return out;
}

/** 2 × 2 px averaged into one */
function halve(px: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array((w / 2) * (h / 2) * 4);
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w / 2; x++) {
      for (let c = 0; c < 4; c++) {
        const at = (dx: number, dy: number) => px[((y * 2 + dy) * w + x * 2 + dx) * 4 + c];
        out[(y * (w / 2) + x) * 4 + c] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4);
      }
    }
  }
  return out;
}

/** a preview at half scale (the source halved, px settings halved) looks as the full-size export does, halved */
export function scaleChecks(): Check[] {
  const stack = new Stack('post fx checks');
  const out: Check[] = [];
  try {
    const full = card(stack, 256, 256, TEXTURED);
    const small = halve(stack.bytes(full), 256, 256);
    const data = Float32Array.from(small, (v) => v / 255);
    const half = stack.g.texture({ width: 128, height: 128, data }, 'rgba16f');
    for (const e of EFFECTS) {
      const l = layer(e.id);
      const big = halve(stack.bytes(stack.render(full, [l], { frame: e.videoOnly ? 0 : null })), 256, 256);
      const preview = stack.bytes(stack.render(half, [l], { frame: e.videoOnly ? 0 : null, scale: 0.5 }));
      const [a, b] = [meanLuminance(big), meanLuminance(preview)];
      const off = Math.abs(a - b) / a;
      out.push({ name: `preview matches export: ${e.id}`, ok: off < 0.03, detail: `brightness ${(off * 100).toFixed(2)} % apart; ${meanDiff(big, preview).toFixed(2)} levels apart on average` });
    }
  } finally {
    stack.release();
  }
  return out;
}

/** each effect alone at its defaults on a 1920 × 1080 card, ms (reading one pixel waits for the GPU) */
export function timings(): Record<string, number> {
  const stack = new Stack('post fx timings');
  try {
    const src = card(stack, 1920, 1080, TEXTURED);
    const times: Record<string, number> = {};
    for (const e of EFFECTS) {
      const l = layer(e.id);
      stack.g.read(stack.render(src, [l], { frame: e.videoOnly ? 0 : null }), { x: 0, y: 0, w: 1, h: 1 });
      const began = performance.now();
      stack.g.read(stack.render(src, [l], { frame: e.videoOnly ? 1 : null }), { x: 0, y: 0, w: 1, h: 1 });
      times[e.id] = +(performance.now() - began).toFixed(1);
    }
    return times;
  } finally {
    stack.release();
  }
}

export const allChecks = (): Check[] => [...pipelineChecks(), ...flickerChecks(), ...loopChecks(), ...datamoshChecks(), ...scaleChecks()];
