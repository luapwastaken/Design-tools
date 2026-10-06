// The cloth the lit preview hangs, in three drapes: a curtain falling in folds, a swag between two
// pins, and a crumple. Each is a height field z(x, y) over the picture (-1..1, y up, z toward the
// viewer) with the outline it hangs in and how closed in each fold is. Pure.

export type Fold = 'curtain' | 'drape' | 'crumple';

export type Cloth = {
  /** half the width at the widest */
  xmax: number;
  top(x: number): number;
  hem(x: number): number;
  z(x: number, y: number): number;
  /** 1 on open ground, less deep in a fold (how much of the room it sees) */
  open(x: number, y: number): number;
};

export const FOLDS: { value: Fold; label: string; tip: string }[] = [
  { value: 'curtain', label: 'Curtain', tip: 'Hung from a rail, falling in two soft folds' },
  { value: 'drape', label: 'Drape', tip: 'A swag between two pins, folds fanning from each' },
  { value: 'crumple', label: 'Crumple', tip: 'Wrinkled cloth with no direction to it' },
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

// ── crumple: flat facets with soft creases between them, no direction ───────────────────────────

/** a hash of the lattice point and a salt, 0..1 */
function hash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** the facets' blend reaches 1.15 cells, the nearest an unsearched cell's point can be */
const REACH6 = 1 / 1.15 ** 12;

/** facets per unit of the picture */
const FACETS = 3.4;

/**
 * Each cell of a jittered grid is a flat facet tipped its own way; the height at a point is the
 * facets round it blended by 1/distance^6, so each stays flat in its middle and creases at the seams.
 */
function crumpleZ(x: number, y: number): number {
  const [u, v] = [x * FACETS, y * FACETS];
  const [cx, cy] = [Math.floor(u), Math.floor(v)];
  let [sum, weight] = [0, 0];
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [ix, iy] = [cx + i, cy + j];
      const [px, py] = [ix + 0.15 + 0.7 * hash(ix, iy, 1), iy + 0.15 + 0.7 * hash(ix, iy, 2)];
      const [dx, dy] = [u - px, v - py];
      const d2 = dx * dx + dy * dy + 1e-4;
      // reaching no further than the cells searched, so a facet drops out at nothing
      const w = 1 / (d2 * d2 * d2) - REACH6;
      if (w <= 0) continue;
      const height = 0.04 * (hash(ix, iy, 5) - 0.5) + (0.34 * (hash(ix, iy, 3) - 0.5) * dx + 0.34 * (hash(ix, iy, 4) - 0.5) * dy) / FACETS;
      sum += w * height;
      weight += w;
    }
  }
  return weight > 0 ? (sum / weight) * 1.5 : 0;
}

const crumple: Cloth = {
  xmax: 0.62,
  top: (x) => TOP - 0.02 + 0.03 * Math.sin(7 * x + 1),
  hem: (x) => HEM + 0.03 * Math.sin(9 * x),
  z: crumpleZ,
  open: (x, y) => 1 - 0.38 * clamp01(0.5 - crumpleZ(x, y) / 0.08),
};

export const CLOTHS: Record<Fold, Cloth> = { curtain, drape, crumple };
