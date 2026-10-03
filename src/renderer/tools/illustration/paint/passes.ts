// The engine's GPU side (plan §1, §2): its programs, its textures and one function per pass.
// Everything is made by one gpuScope('paint'), so release() frees it all.
import type { Gpu, Instances, Program, Rect, Texture } from '../../../lib/gpu/index.ts';
import { BODY_LAYOUT, BODY_STRIDE, BRISTLE_LAYOUT, BRISTLE_STRIDE, headStrength, wetStrength } from './bristles.ts';
import { PAPER as PAPER_GLSL } from './glsl/common.ts';
import { COMPOSITE } from './glsl/composite.ts';
import { DECODE, ENCODE, LIT, SCREEN } from './glsl/display.ts';
import { BODY_FS, BODY_VS, BRISTLE_FS, BRISTLE_VS, CARRY, INIT } from './glsl/stroke.ts';
import { PAPER_RGB } from './paper.ts';
import { LiveStroke } from './stroke.ts';
import { BRISTLES, FILM, GOUACHE, INPUT, PAPER, PICKUP, SMUDGE, STAIN, STREAKS, WET } from './tuning.ts';
import { HEIGHT, WIDTH } from './types.ts';

export type Programs = {
  paper: Program;
  init: Program;
  carry: Program[];
  body: Program;
  bristle: Program[];
  composite: Program;
  lit: Program;
  screen: Program;
  encode: Program;
  decode: Program;
};

/** Every program, compiled in parallel where the driver can. `split`: bristles and pickup as two draws each. */
export async function compile(g: Gpu, split: boolean): Promise<Programs> {
  const [paper, init, body, composite, lit, screen, encode, decode, ...rest] = await Promise.all([
    g.programAsync(PAPER_GLSL),
    g.programAsync(INIT),
    g.programAsync(BODY_FS, BODY_VS),
    g.programAsync(COMPOSITE),
    g.programAsync(LIT),
    g.programAsync(SCREEN),
    g.programAsync(ENCODE),
    g.programAsync(DECODE),
    ...(split ? [g.programAsync(CARRY('paint')), g.programAsync(CARRY('state'))] : [g.programAsync(CARRY('all'))]),
    ...(split ? [g.programAsync(BRISTLE_FS('mask'), BRISTLE_VS), g.programAsync(BRISTLE_FS('film'), BRISTLE_VS)] : [g.programAsync(BRISTLE_FS('all'), BRISTLE_VS)]),
  ]);
  const n = split ? 2 : 1;
  return { paper, init, body, composite, lit, screen, encode, decode, carry: rest.slice(0, n), bristle: rest.slice(n) };
}

export type Surfaces = {
  paper: Texture<'rgba8'>;
  base: Texture<'rgba16f'>;
  shown: Texture<'rgba16f'>;
  mask: Texture<'rgba16f'>;
  film: Texture<'rgba16f'>[];
  lit: Texture<'rgba16f'>;
  encoded: Texture<'rgba8'>;
  /** where undo and redo park the painting's rect while they trade it with a step's copy */
  scratch: Texture<'rgba16f'>;
  /** what each hair carries per step, two sets that alternate between frames */
  carry: Texture<'rgba32f'>[][];
  stepPos: Texture<'rgba32f'>;
  stepPrm: Texture<'rgba32f'>;
  bristles: Instances;
  bodies: Instances;
};

const size = { width: WIDTH, height: HEIGHT };
const rows = { width: BRISTLES.max, height: INPUT.maxSteps };
export const PAPER_BARE: [number, number, number, number] = [...PAPER_RGB, 0];
export const WHOLE: Rect = { x: 0, y: 0, w: WIDTH, h: HEIGHT };

/** the textures and every framebuffer the passes draw into, made before anything is drawn (see warmUp) */
export function surfaces(g: Gpu): Surfaces {
  const t16 = () => g.texture(size, 'rgba16f', { filter: 'nearest' });
  const t32 = () => g.texture(rows, 'rgba32f');
  const s: Surfaces = {
    paper: g.texture(size, 'rgba8', { filter: 'nearest' }),
    base: t16(),
    shown: t16(),
    mask: t16(),
    film: [t16(), t16(), t16(), t16()],
    lit: g.texture(size, 'rgba16f'),
    encoded: g.texture(size, 'rgba8', { filter: 'nearest' }),
    scratch: t16(),
    carry: [0, 1].map(() => [t32(), t32(), t32(), t32(), t32()]),
    stepPos: t32(),
    stepPrm: t32(),
    bristles: g.instances(new Float32Array(0), BRISTLE_LAYOUT),
    bodies: g.instances(new Float32Array(0), BODY_LAYOUT),
  };
  for (const t of [s.paper, s.base, s.shown, s.mask, s.lit, s.encoded, s.scratch, ...s.film]) g.prepare(t);
  for (const list of [s.film, [s.mask, ...s.film], [s.base, s.shown], ...s.carry, ...s.carry.map((c) => c.slice(0, 4)), ...s.carry.map((c) => c[4])]) g.prepare(list);
  return s;
}

/** the stroke's mask cleared and its film started (plan §2, begin) */
export function beginStroke(g: Gpu, p: Programs, s: Surfaces, live: LiveStroke): void {
  g.clear(s.mask, [0, 0, 0, 0]);
  const mode = live.o.tool === 'smudge' ? 2 : live.o.medium === 'wet' ? 0 : 1;
  if (mode === 0) {
    // the paint at the brush's starting strength (bristles.ts: conc)
    const c = wetStrength(live.o.load);
    const k = live.paint;
    s.film.forEach((t, i) => g.clear(t, [k[i * 4] * c, k[i * 4 + 1] * c, k[i * 4 + 2] * c, k[i * 4 + 3] * c]));
    return;
  }
  g.pass(p.init, { output: s.film, inputs: { u_base: s.base }, uniforms: { u_paint: live.paint, u_mode: mode, u_rewet: GOUACHE.rewet } });
}

/** one frame of the live stroke, after live.frame(): pickup, the body, the hairs, then the composite and its lit rect */
export function drawStroke(g: Gpu, p: Programs, s: Surfaces, live: LiveStroke, steps: number, rect: Rect | null): void {
  const o = live.out;
  const b = live.brush;
  const smudge = b.tool === 'smudge';
  const carry = b.pickup > 0 && steps > 0;
  const from = s.carry[live.carrySet];
  const to = s.carry[1 - live.carrySet];
  if (carry) {
    const band = { x: 0, y: 0, w: BRISTLES.max, h: steps };
    s.stepPos.write(band, o.pos.subarray(0, BRISTLES.max * steps * 4));
    s.stepPrm.write(band, o.prm.subarray(0, BRISTLES.max * steps * 4));
    const inputs = { u_under: s.base, u_pos: s.stepPos, u_prm: s.stepPrm, u_c0: from[0], u_c1: from[1], u_c2: from[2], u_c3: from[3], u_c4: from[4] };
    const uniforms = {
      u_smudge: smudge ? 1 : 0,
      u_heightPower: PICKUP.smudgeHeightPower,
      u_hold: PICKUP.smudgeHold * live.o.load,
      u_fullHeight: PICKUP.fullHeight,
      u_dirtMax: PICKUP.dirtMax,
      u_pushOut: PICKUP.pushOut,
      u_prevRow: Math.max(0, live.lastRow),
      u_first: live.lastRow < 0 ? 1 : 0,
    };
    const at = { x: 0, y: 0, w: Math.min(BRISTLES.max, b.hairs.length), h: steps };
    if (p.carry.length === 1) g.pass(p.carry[0], { output: to, inputs, uniforms, rect: at });
    else {
      g.pass(p.carry[0], { output: to.slice(0, 4), inputs, uniforms, rect: at });
      g.pass(p.carry[1], { output: to[4], inputs, uniforms, rect: at });
    }
    live.lastRow = steps - 1;
    live.carrySet = 1 - live.carrySet;
  }
  if (b.wet && o.nBodies) {
    s.bodies.update(o.bodies.subarray(0, o.nBodies * BODY_STRIDE));
    g.pass(p.body, { output: s.mask, instances: s.bodies, blend: 'max' });
  }
  if (o.nBristles) {
    s.bristles.update(o.bristles.subarray(0, o.nBristles * BRISTLE_STRIDE));
    const c = s.carry[live.carrySet];
    const streak = b.kind === 'dry' ? STREAKS.dry : b.wet ? STREAKS.wet : STREAKS.gouache;
    const opts = {
      instances: s.bristles,
      inputs: { u_paper: s.paper, u_c0: c[0], u_c1: c[1], u_c2: c[2], u_c3: c[3], u_c4: c[4] },
      uniforms: { u_paint: live.paint, u_useCarry: b.pickup > 0 && live.lastRow >= 0 ? 1 : 0, u_smudge: smudge ? 1 : 0, u_hard: streak.hard, u_streakLen: streak.length, u_streak: streak.amount, u_edgeStreak: BRISTLES.edgeStreak, u_seed: live.seed },
      blendConstant: smudge ? SMUDGE.film : FILM,
    };
    if (p.bristle.length === 1) g.pass(p.bristle[0], { ...opts, output: [s.mask, ...s.film], blend: ['max', 'constant', 'constant', 'constant', 'constant'] });
    else {
      g.pass(p.bristle[0], { ...opts, output: s.mask, blend: 'max' });
      g.pass(p.bristle[1], { ...opts, output: s.film, blend: 'constant' });
    }
  }
  if (!rect) return;
  const l = live.o.loaded;
  const mode = smudge ? 2 : b.wet ? 0 : 1;
  g.pass(p.composite, {
    output: s.shown,
    rect,
    inputs: { u_base: s.base, u_mask: s.mask, u_k0: s.film[0], u_k1: s.film[1], u_k2: s.film[2], u_k3: s.film[3], u_paper: s.paper },
    uniforms: {
      u_mode: mode,
      u_thick: mode === 0 ? WET.thick : mode === 1 ? GOUACHE.thick : SMUDGE.cover,
      u_smudgeAlpha: SMUDGE.alpha,
      u_dryBoost: WET.dryBoost,
      u_head: headStrength(b),
      u_headAmount: WET.headAmount,
      u_rimK: WET.rimK,
      u_rimW: WET.rimW,
      u_edgeAmp: Math.min(WET.wanderMax, live.o.size * WET.wander),
      u_gran: l?.granulation ?? 0,
      u_hollow: WET.hollow,
      u_wash: WET.wash,
      u_hairsOnly: b.kind === 'dry' ? 1 : 0,
      u_seed: live.seed,
      u_stain: STAIN * (l?.staining ?? 0),
      u_wetHeight: WET.height,
      u_poolAmount: WET.poolAmount,
      u_pool: WET.pool,
    },
  });
  lit(g, p, s, grown(rect, 1));
}

/**
 * Every pass run once on the real textures, then left as it was: the driver builds each shader for
 * the textures it draws into only when it first draws (ANGLE on D3D11 does), which would stall the
 * first stroke of each kind by a quarter of a second. Queued, not waited on: the caller waits with
 * a fence, so the page stays free while the GPU process compiles.
 */
export function warmUp(g: Gpu, p: Programs, s: Surfaces): void {
  const dot = g.texture({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 0]) }, 'rgba8', { filter: 'nearest' });
  const out = g.texture({ width: 4, height: 4 }, 'rgba8', { filter: 'nearest' });
  g.prepare(out);
  g.pass(p.paper, { output: s.paper });
  const at = (x: number, y: number) => ({ x, y, t: 0, pressure: 0.5, tilt: null });
  const paint = { paint: { K: new Float64Array(36).fill(0.5), S: new Float64Array(36).fill(1) }, opacity: 0.5, granulation: 0.5, staining: 0.5 };
  for (const [tool, medium, brush] of [['paint', 'wet', 'round'], ['paint', 'wet', 'dry'], ['paint', 'dry', 'flat'], ['smudge', 'dry', 'flat']] as const) {
    const live = new LiveStroke({ tool, medium, brush, size: 8, load: 0.5, loaded: tool === 'paint' ? paint : null }, at(8, 8), 1);
    beginStroke(g, p, s, live);
    const f = live.frame([at(10, 9)], { last: at(12, 10) });
    drawStroke(g, p, s, live, f.steps, f.rect);
  }
  decode(g, p, s, dot, false);
  screen(g, p, s, out);
  dot.release();
  out.release();
  g.clear([s.base, s.shown], PAPER_BARE);
  lit(g, p, s, WHOLE);
}

export function grown(r: Rect, by: number): Rect {
  const x = Math.max(0, r.x - by);
  const y = Math.max(0, r.y - by);
  return { x, y, w: Math.min(WIDTH, r.x + r.w + by) - x, h: Math.min(HEIGHT, r.y + r.h + by) - y };
}

/** the relief-lit look of `rect` */
export function lit(g: Gpu, p: Programs, s: Surfaces, rect: Rect): void {
  g.pass(p.lit, { output: s.lit, rect, inputs: { u_shown: s.shown, u_paper: s.paper }, uniforms: { u_relief: PAPER.relief, u_fill: PAPER.fill, u_stand: PAPER.stand, u_wash: PAPER.washHeight, u_mottle: PAPER.mottle } });
}

/** the lit painting at the screen texture's size, sRGB */
export function screen(g: Gpu, p: Programs, s: Surfaces, out: Texture<'rgba8'>): void {
  g.pass(p.screen, { output: out, inputs: { u_lit: s.lit }, uniforms: { u_scale: [WIDTH / out.width, HEIGHT / out.height] } });
}

export function encode(g: Gpu, p: Programs, s: Surfaces, rect: Rect): void {
  g.pass(p.encode, { output: s.encoded, rect, inputs: { u_base: s.base } });
}

/** bytes (a saved painting or the CPU copy, as an rgba8 texture) into the painting */
export function decode(g: Gpu, p: Programs, s: Surfaces, src: Texture<'rgba8'>, v1: boolean): void {
  g.pass(p.decode, { output: [s.base, s.shown], inputs: { u_src: src }, uniforms: { u_v1: v1 ? 1 : 0, u_paperRgb: PAPER_RGB } });
}
