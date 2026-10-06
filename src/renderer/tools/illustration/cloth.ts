// The cloth the lit preview hangs, in three drapes: a curtain falling in folds, a swag between two
// pins, and a crumple. Each is a height field z(x, y) over the picture (-1..1, y up, z toward the
// viewer) with the outline it hangs in and how closed in each fold is. Pure.

export type Fold = 'curtain' | 'drape' | 'crumple';

export type Cloth = {
  /** half the width at the widest */
  xmax: number;
  /** half the width at a height, when the sides are not straight */
  half?(y: number): number;
  top(x: number): number;
  hem(x: number): number;
  z(x: number, y: number): number;
  /** 1 on open ground, less deep in a fold (how much of the room it sees) */
  open(x: number, y: number): number;
};

export const FOLDS: { value: Fold; label: string; tip: string }[] = [
  { value: 'curtain', label: 'Curtain', tip: 'Hung from a rail, falling in two soft folds' },
  { value: 'drape', label: 'Drape', tip: 'A swag between two pins, folds fanning from each' },
  { value: 'crumple', label: 'Crumple', tip: 'Cloth creased at every angle, long folds and fine ones' },
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ── curtain: the first cloth the preview had ────────────────────────────────────────────────────

const CURTAIN_X = 0.64;
const TOP = 0.76;
const HEM = -0.74;
/** deep enough that even a small preview spans the ramp from lit ridge to shaded valley */
const DEPTH = 0.15;

const curtainFold = (x: number) => {
  const u = (x / CURTAIN_X + 1) / 2;
  // unequal widths, as cloth never falls evenly
  return -Math.cos(4 * Math.PI * (u + 0.05 * Math.sin(2 * Math.PI * u)));
};
const drop = (y: number) => 0.3 + 0.7 * clamp01((TOP - y) / (TOP - HEM));
const curtainZ = (x: number, y: number) => DEPTH * drop(y) * curtainFold(x);

const curtain: Cloth = {
  xmax: CURTAIN_X,
  top: () => TOP,
  hem: () => HEM,
  z: curtainZ,
  // the valleys see less of the room, most of all where the folds are deep
  open: (x, y) => 1 - 0.4 * ((1 - curtainFold(x)) / 2) * drop(y),
};

// ── drape: a swag between two pins, folds fanning out from each ─────────────────────────────────

const PIN_X = 0.58;
const PIN_Y = 0.74;
const SAG = 0.3;
const FANS = 13;

/** the fold of the fan from one pin: -1 in a valley, 1 on a ridge, growing out from the pin */
function fan(x: number, y: number, side: -1 | 1): number {
  const dx = (x - side * PIN_X) * -side; // toward the middle is positive
  const dy = PIN_Y - y;
  const r = Math.hypot(dx, dy);
  const turn = Math.atan2(dx, dy); // 0 straight down from the pin
  return Math.cos(FANS * turn + 0.7) * smooth(0.02, 0.5, r);
}

const drapeShape = (x: number, y: number) => {
  const right = smooth(-0.35, 0.35, x);
  const folds = (1 - right) * fan(x, y, -1) + right * fan(x, y, 1);
  // the cloth bellies forward between the pins and hangs closer to the wall at the hem
  const belly = 0.05 * (1 - (x / 0.64) ** 2) * clamp01((0.9 - y) / 1.6);
  return { folds, belly };
};

const drape: Cloth = {
  xmax: 0.64,
  top: (x) => PIN_Y - SAG * (1 - clamp01(Math.abs(x) / PIN_X) ** 2),
  hem: (x) => HEM + 0.03 * Math.sin(5 * x),
  z: (x, y) => {
    const { folds, belly } = drapeShape(x, y);
    return 0.11 * folds + belly;
  },
  open: (x, y) => 1 - 0.38 * ((1 - drapeShape(x, y).folds) / 2) * smooth(0.0, 0.6, PIN_Y - y),
};

// ── crumple: long creases at every angle, finer ones across them ────────────────────────────────

/** a crease: a line segment (centre, direction, half length) with a ridge along it, rounded on top and sagging softly either side */
type Crease = { x: number; y: number; c: number; s: number; half: number; width: number; amp: number };

/** a hash of a counter and a salt, 0..1 */
function hash(i: number, salt: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(salt, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** `n` creases of one scale, laid out from fixed hashes so the cloth is always the same cloth */
const creases = (n: number, salt: number, half: [number, number], width: [number, number], amp: [number, number]): Crease[] =>
  Array.from({ length: n }, (_, i) => {
    const a = Math.PI * hash(i, salt + 1);
    const mix = (r: [number, number], k: number) => r[0] + (r[1] - r[0]) * hash(i, salt + k);
    return { x: 1.3 * (hash(i, salt + 2) - 0.5), y: 1.5 * (hash(i, salt + 3) - 0.5), c: Math.cos(a), s: Math.sin(a), half: mix(half, 4), width: mix(width, 5), amp: mix(amp, 6) };
  });

// the long ones first, then the finer ones, which fall across them
const CREASES: Crease[] = [...creases(9, 10, [0.45, 0.85], [0.06, 0.1], [0.06, 0.1]), ...creases(14, 40, [0.18, 0.4], [0.025, 0.045], [0.012, 0.022])];

function crumpleZ(x: number, y: number): number {
  let z = 0;
  for (const g of CREASES) {
    const [dx, dy] = [x - g.x, y - g.y];
    const along = dx * g.c + dy * g.s;
    const a = Math.abs(along) / g.half;
    if (a >= 1) continue;
    const across = Math.abs(-dx * g.s + dy * g.c) / g.width;
    if (across > 8) continue;
    // a ridge with a soft crown and a broad sag either side, both dying out toward the ends
    const q = across / 2.5;
    const ridge = (1 / (1 + across * across) - 0.4 / (1 + q * q)) * (1 - across / 8);
    const end = 1 - a * a;
    z += g.amp * ridge * end * end;
  }
  // the whole cloth billows a little between the creases
  return z + 0.04 * Math.sin(2.3 * x + 0.6) * Math.sin(1.9 * y + 1.1);
}

const crumple: Cloth = {
  xmax: 0.66,
  half: (y) => 0.62 + 0.03 * Math.sin(5 * y + 1) + 0.015 * Math.sin(13 * y),
  top: (x) => TOP - 0.02 + 0.03 * Math.sin(7 * x + 1),
  hem: (x) => HEM + 0.03 * Math.sin(9 * x),
  z: crumpleZ,
  open: (x, y) => 1 - 0.38 * clamp01(0.3 - crumpleZ(x, y) / 0.05),
};

export const CLOTHS: Record<Fold, Cloth> = { curtain, drape, crumple };
