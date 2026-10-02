// The brushes as rows of bristles (plan §3), pure so the tests drive it. Each hair has its own place
// across the brush, length, width and load. At every step each hair draws a capsule from its last
// contact to its new one, so its streak is continuous at any spacing; a grain in stroke space
// (shaders) breaks the streaks up. Load runs down per hair with travel.
import type { Step } from './input.ts';
import { BRISTLES as B, LOAD, PICKUP, STREAKS } from './tuning.ts';
import type { BrushKind, Medium, StrokeTool } from './types.ts';

/** the footprint's width at a pressure, painting px */
export function brushWidth(brush: BrushKind, size: number, pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  if (brush === 'round') return size * (0.2 + 0.8 * p ** 0.8);
  if (brush === 'flat') return size * (0.88 + 0.12 * p);
  return size * (0.6 + 0.4 * p);
}

/**
 * floats per bristle instance: a_seg (from x, y, to x, y), a_prm (half width, amount from, to,
 * hair), a_prm2 (arc from, to, gate, concentration), a_step (row of this frame), a_meta (1 for a
 * hair's first contact, whose round start is its own; the hair's clump; how near the edge it is)
 */
export const BRISTLE_LAYOUT = { a_seg: 4, a_prm: 4, a_prm2: 4, a_step: 1, a_meta: 3 } as const;
export const BRISTLE_STRIDE = 16;
/** floats per body instance: a_seg, a_prm (half width, water from, to, unused) */
export const BODY_LAYOUT = { a_seg: 4, a_prm: 4 } as const;
export const BODY_STRIDE = 8;

type Contact = { x: number; y: number; a: number; s: number };
export type Hair = {
  id: number;
  /** across the brush, -1 to 1 */
  u: number;
  len: number;
  load: number;
  /** half width, as a share of the brush's width */
  hw: number;
  /** hairs of a clump streak together */
  clump: number;
  /** 0 in the middle, 1 at the edge */
  edge: number;
  last: Contact | null;
  /** what a smudge hair spent of what it carries, since the last pickup row */
  use: number;
};

export type Brush = {
  kind: BrushKind;
  tool: StrokeTool;
  wet: boolean;
  size: number;
  load: number;
  hairs: Hair[];
  streak: { hard: number; length: number; amount: number };
  /** px of travel a full hair lasts */
  capacity: number;
  /** pickup per 12 px of travel: gouache and the smudge; 0 for watercolour */
  pickup: number;
  /** this step's width, the mean load and the footprint's last centre and water (the body pass) */
  width: number;
  loadMean: number;
  centre: { x: number; y: number; water: number } | null;
};

/** xorshift32, seeded */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** a slow value noise over x, 0..1 */
function wander(x: number): number {
  const h = (n: number) => {
    let v = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    v ^= v >>> 13;
    v = Math.imul(v, 0xc2b2ae35);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const i = Math.floor(x);
  const t = x - i;
  return h(i) + (h(i + 1) - h(i)) * t * t * (3 - 2 * t);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type BrushSpec = { kind: BrushKind; tool: StrokeTool; medium: Medium; size: number; load: number; seed: number };

export function makeBrush(o: BrushSpec): Brush {
  const r = rng(o.seed * 7919);
  const wet = o.tool === 'paint' && o.medium === 'wet';
  const places: { u: number; len: number; clump: number }[] = [];
  if (o.kind === 'dry') {
    // clumps of uneven size at random places: no comb
    const clumps = Math.round(Math.min(B.dry.max, Math.max(B.dry.min, o.size * B.dry.perPx)));
    for (let c = 0; c < clumps; c++) {
      const cu = -0.95 + 1.9 * r();
      const k = 1 + Math.floor(r() * r() * B.dry.hairs);
      const spread = 0.015 + 0.06 * r();
      for (let j = 0; j < k; j++) places.push({ u: cu + (r() - 0.5) * spread, len: 0.9 + r() * 0.2, clump: c });
    }
  } else {
    const c = o.kind === 'flat' ? B.flat : B.round;
    const n = Math.round(Math.min(c.max, Math.max(c.min, o.size * c.perPx)));
    const clumps = Math.max(3, Math.round(n / B.clumpHairs));
    for (let i = 0; i < n; i++) {
      const u = -1 + (2 * (i + 0.15 + 0.7 * r())) / n;
      // a round's tip is pointed: its middle hairs are the longest
      const len = o.kind === 'round' ? 1 - B.roundTip * u * u + (r() - 0.5) * 0.12 : 0.97 + r() * 0.06;
      places.push({ u, len, clump: Math.min(clumps - 1, Math.floor(((u + 1) / 2) * clumps)) });
    }
  }
  const list = places.slice(0, B.max);
  const spread = o.kind === 'dry' ? B.spread.dry : wet ? B.spread.wet : B.spread[o.kind];
  const hairs = list.map(({ u, len, clump }, id) => ({
    id,
    u,
    len,
    // the edge hairs hold a little less, so a stroke breaks up from its edges as it runs dry
    load: o.tool === 'smudge' ? 0 : Math.min(1, o.load * (0.75 + 0.5 * r()) * (1 - B.edgeDry * smooth(0.6, 1, Math.abs(u)))),
    hw: (spread / list.length) * (0.7 + 0.6 * r()),
    clump,
    edge: smooth(0.7, 1, Math.abs(u)),
    last: null,
    use: 0,
  }));
  const streak = o.kind === 'dry' ? STREAKS.dry : wet ? STREAKS.wet : STREAKS.gouache;
  // bigger brushes hold more but spend it faster per px
  const capacity = (wet ? LOAD.wet : LOAD.gouache) * Math.sqrt(40 / Math.max(o.size, 8)) * (0.4 + o.load);
  const pickup = o.tool === 'smudge' ? PICKUP.smudge * o.load : wet ? 0 : PICKUP.gouache;
  return { kind: o.kind, tool: o.tool, wet, size: o.size, load: o.load, hairs, streak, capacity, pickup, width: 0, loadMean: o.load, centre: null };
}

/** the brush's width at this step, tilt and the smudge's steady width included */
function stepWidth(b: Brush, st: Step): number {
  if (b.tool === 'smudge') return b.size * (B.smudgeWidth + (1 - B.smudgeWidth) * st.p);
  return brushWidth(b.kind, b.size, st.p) * (b.kind === 'round' ? st.tilt.widen : 1);
}

export type Box = { x0: number; y0: number; x1: number; y1: number };
const grow = (box: Box | null, x: number, y: number, r: number): Box =>
  box ? { x0: Math.min(box.x0, x - r), y0: Math.min(box.y0, y - r), x1: Math.max(box.x1, x + r), y1: Math.max(box.y1, y + r) } : { x0: x - r, y0: y - r, x1: x + r, y1: y + r };

/** where one frame's instances and pickup rows go; the stroke owns the arrays and reuses them */
export type StepOut = {
  bristles: Float32Array;
  nBristles: number;
  bodies: Float32Array;
  nBodies: number;
  /** per hair (x) and step of the frame (y), 128 wide: position and sampling offset, then contact, take, use, spacing */
  pos: Float32Array;
  prm: Float32Array;
  box: Box | null;
};

/** One step of the brush: each hair's new contact and its capsule, the footprint's body, and the pickup row `row`. */
export function brushStep(b: Brush, st: Step, row: number, out: StepOut): void {
  const W = stepWidth(b, st);
  const nx = -st.dy;
  const ny = st.dx;
  const cx = st.x + st.tilt.ox * b.size;
  const cy = st.y + st.tilt.oy * b.size;
  const gateStart = b.kind === 'dry' ? LOAD.gateStartDry : LOAD.gateStart;
  let loadSum = 0;
  for (const h of b.hairs) {
    const reach = h.len * (0.3 + 0.7 * st.p) - (b.kind === 'round' ? 0.55 * h.u * h.u * (1 - st.p) : 0);
    // a round touches down as a round dab: its side hairs meet the paper a little after the middle ones
    const start = b.kind === 'round' ? 0.5 * W * (1 - Math.sqrt(Math.max(0, 1 - h.u * h.u))) : 0;
    const contact = smooth(0.24, 0.42, reach) * (start > 0 ? smooth(start - 1, start + 2, st.s) : 1);
    // hairs aren't rigid: each wanders across the stroke, slowly; a round's side hairs trail its middle
    const splay = b.kind === 'flat' ? 1 : 0.9 + 0.2 * st.p;
    const off = ((h.u * W) / 2) * splay + W * B.wander * (wander(h.id * 13.7 + st.s / 70) - 0.5);
    const back = b.kind === 'round' ? h.u * h.u * W * 0.12 : 0;
    const x = cx + nx * off - st.dx * back;
    const y = cy + ny * off - st.dy * back;
    const hw = Math.max(0.6, h.hw * W * 0.5);
    let amt: number;
    let gate = 0;
    // watercolour carries its load as the paint's strength in the film, which blends softly along
    // the stroke; the hairs lay water wherever they touch
    const conc = b.wet ? 0.35 + 0.65 * h.load : 1;
    if (b.tool === 'smudge') {
      amt = contact;
      h.use += (st.ds * contact) / PICKUP.smudgeUse;
    } else {
      amt = contact * (b.wet ? 1 : smooth(0, 0.45, h.load));
      h.load = Math.max(0, h.load - (st.ds * contact) / b.capacity);
      // gouache running out skips across the tooth; the dry brush does from the start, in both media
      if (!b.wet || b.kind === 'dry') gate = Math.min(0.95, Math.max(0, gateStart - h.load * LOAD.gatePerLoad - st.p * LOAD.gatePerP));
    }
    loadSum += h.load;
    const prev = h.last ?? { x, y, a: amt, s: st.s - st.ds };
    if ((amt > 0.004 || prev.a > 0.004) && out.nBristles < out.bristles.length / BRISTLE_STRIDE) {
      const f = out.bristles;
      const o = out.nBristles++ * BRISTLE_STRIDE;
      f[o] = prev.x;
      f[o + 1] = prev.y;
      f[o + 2] = x;
      f[o + 3] = y;
      f[o + 4] = hw;
      f[o + 5] = prev.a;
      f[o + 6] = amt;
      f[o + 7] = h.id;
      f[o + 8] = prev.s;
      f[o + 9] = st.s;
      f[o + 10] = gate;
      f[o + 11] = conc;
      f[o + 12] = row;
      f[o + 13] = h.last ? 0 : 1;
      f[o + 14] = h.clump;
      f[o + 15] = h.edge;
      out.box = grow(grow(out.box, x, y, hw + 2), prev.x, prev.y, hw + 2);
    }
    if (h.id < B.max && b.pickup > 0) {
      const o = (row * B.max + h.id) * 4;
      out.pos[o] = x;
      out.pos[o + 1] = y;
      out.pos[o + 2] = nx * hw * 0.4;
      out.pos[o + 3] = ny * hw * 0.4;
      out.prm[o] = amt > 0.004 ? 1 : 0;
      out.prm[o + 1] = (b.pickup * st.ds) / 12;
      out.prm[o + 2] = h.use;
      out.prm[o + 3] = st.ds;
      h.use = 0;
    }
    h.last = { x, y, a: amt, s: st.s };
  }
  b.loadMean = loadSum / b.hairs.length;
  b.width = W;
  if (b.wet && b.kind !== 'dry') body(b, cx, cy, W, nx, ny, out);
  else out.box = grow(out.box, cx, cy, W / 2 + 3);
}

/**
 * A watercolour wash's footprint (its rim and its water), the brush's own shape and a touch wider
 * than the hairs, as the edge wanders inward from it: a Round sweeps a disc from step to step; a Flat
 * lays its edge across the stroke at every step, with corners rounded a little. The Dry brush has
 * none: only its hairs leave marks.
 */
function body(b: Brush, cx: number, cy: number, W: number, nx: number, ny: number, out: StepOut): void {
  const put = (x0: number, y0: number, x1: number, y1: number, hw: number) => {
    out.bodies.set([x0, y0, x1, y1, hw, 1, 1, 0], out.nBodies++ * BODY_STRIDE);
    out.box = grow(grow(out.box, x0, y0, hw + 3), x1, y1, hw + 3);
  };
  if (b.kind === 'round') {
    const c = b.centre ?? { x: cx, y: cy, water: 1 };
    put(c.x, c.y, cx, cy, (W / 2) * 1.04);
  } else {
    const r = Math.min(W / 2, B.flatCorner);
    const reach = W / 2 - r;
    put(cx - nx * reach, cy - ny * reach, cx + nx * reach, cy + ny * reach, r + 0.02 * W);
  }
  b.centre = { x: cx, y: cy, water: 1 };
}
