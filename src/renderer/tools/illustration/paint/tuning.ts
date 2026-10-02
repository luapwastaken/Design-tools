// Every tunable constant of the engine (plan §2, §3), each with what it does. Tuned on the stroke
// sheet (sheet.ts); the smoke checks hold the look to the thresholds in plan §6.

/** the paper, and how its relief is lit on screen only (never saved, never picked) */
export const PAPER = {
  /** bare paper, linear sRGB: a warm off-white, about #F1F0EA */
  rgb: [0.88, 0.87, 0.83] as const,
  /** how strongly the tooth is lit from the top left */
  relief: 0.38,
  /** paint above a wash's height (PAPER.washHeight) fills the tooth by this much, and stands this high itself */
  fill: 0.65,
  stand: 0.55,
  /** a wash's height: the tooth shows through it untouched */
  washHeight: 0.25,
};

/** pointer samples to brush steps (input.ts) */
export const INPUT = {
  /** One Euro: the cutoff at rest, Hz; how fast it opens with speed, per px; the speed estimate's cutoff, Hz.
   *  A steep opening keeps the filter's lag under 1/(2π·beta) px at any speed, so sparse samples of a fast
   *  curve keep their shape while a slow hand's tremor is smoothed */
  minCutoff: 1,
  beta: 0.4,
  dCutoff: 5,
  /** pressure is smoothed on its own, Hz */
  pressureCutoff: 3,
  /** step spacing, as a share of the size, then clamped, px */
  spacing: 0.06,
  spacingMin: 1,
  spacingMax: 6,
  /** at most this many steps a frame: past it the spacing grows */
  maxSteps: 64,
  /** a mouse or finger: pressure from speed, p = clamp(fast - v / per, floor, 1), v in px/s */
  speedFast: 1.15,
  speedPer: 2600,
  speedFloor: 0.3,
  /** and a start taper over this share of the size of travel; the taper's thinnest */
  taper: 0.9,
  taperFrom: 0.15,
  /** the thinnest a step gets */
  minPressure: 0.02,
  /** a tilted pen: the most a Round widens, lying flat, and how far its footprint shifts (share of the size) */
  tiltWiden: 1.8,
  tiltShift: 0.35,
  /** each step turns the brush this share of the way toward the direction of travel */
  turn: 0.45,
};

/** the brushes as rows of bristles (bristles.ts) */
export const BRISTLES = {
  /** at most this many (the carry textures are this wide) */
  max: 128,
  /** hairs per px of size, and the range */
  round: { perPx: 0.5, min: 14, max: 110 },
  flat: { perPx: 0.6, min: 14, max: 110 },
  /** dry brush: clumps per px of size, their range, and up to this many hairs each */
  dry: { perPx: 0.1, min: 6, max: 20, hairs: 7 },
  /** how wide each hair lays paint, relative to an even share of the width */
  spread: { round: 1.6, flat: 1.4, dry: 0.85, wet: 3.2 },
  /** about this many hairs streak together as a clump */
  clumpHairs: 4,
  /** edge hairs streak this much more */
  edgeStreak: 0.8,
  /** how much a Round's middle hairs outreach its sides */
  roundTip: 0.28,
  /** the smudge keeps its width: at pressure p it is size × (smudgeWidth + (1 - smudgeWidth) p) */
  smudgeWidth: 0.85,
  /** how far each hair wanders across the stroke, as a share of the width */
  wander: 0.035,
  /** the edge hairs hold this much less paint */
  edgeDry: 0.3,
  /** a watercolour Flat's wash has corners this round, px */
  flatCorner: 16,
};

/** per brush and medium: hair edge hardness, streak length (px) and how much the streaks break the paint */
export const STREAKS = {
  wet: { hard: 0, length: 45, amount: 0.25 },
  gouache: { hard: 0.45, length: 26, amount: 0.55 },
  dry: { hard: 0.6, length: 14, amount: 0.75 },
};

/** paint load and its run-down */
export const LOAD = {
  /** px of travel a full hair lasts at size 40 (bigger brushes spend faster per px); watercolour runs longer */
  gouache: 1500,
  wet: 2600,
  /** below this load gouache starts catching only the paper's peaks: gate = start - perLoad × load - perP × p */
  gateStart: 1.02,
  gateStartDry: 1.12,
  gatePerLoad: 1.5,
  gatePerP: 0.3,
};

/** pickup: what a gouache brush takes from the paint under it, and the smudge */
export const PICKUP = {
  /** per 12 px of travel */
  gouache: 0.08,
  smudge: 0.35,
  /** the most of a gouache brush's paint that can be picked-up paint */
  dirtMax: 0.4,
  /** fresh paint pushes picked-up paint out over this many px */
  pushOut: 150,
  /** paint this high (gouache, fully loaded) gives all a hair can take; a thin wash gives little */
  fullHeight: 0.8,
  /** a smudge hair runs out of what it carries over this many px */
  smudgeUse: 160,
};

/** watercolour's look (composite, mode 0) */
export const WET = {
  /** how thick a full wash lays, in km.ts paint units */
  thick: 0.05,
  /** the thickness the glaze test uses for each of two washes */
  glazeCheck: 0.04,
  /** share of the wash carried by the water (the rest by the bristles); the Dry brush lays hair marks only */
  wash: 0.75,
  /** the rim: how much denser the edge dries, over how many px, and how much paler the middle is */
  rimK: 2.2,
  rimW: 2,
  hollow: 0.25,
  /** the edge wanders inward by up to this share of the size, capped in px */
  wander: 0.07,
  wanderMax: 5,
  /** each wash pools through its own noise at these scales, px */
  pool: [38, 110] as const,
  poolAmount: 0.44,
  /** the height a wash leaves (0 bare paper, 1 thick gouache): enough for a smudge to move a little of it */
  height: 0.25,
};

/** gouache (composite, mode 1) */
export const GOUACHE = {
  /** how thick a full stroke lays */
  thick: 1.4,
  /** the paint under it mixes in by its height times this (re-wetting) */
  rewet: 0.6,
};

/** the smudge (composite, mode 2) */
export const SMUDGE = {
  thick: 0.55,
  /** how fast the carried paint replaces what's in the film, per hair fragment */
  film: 0.45,
};

/** how fast a paint hair's paint replaces what's in the film, per fragment (a constant-alpha blend) */
export const FILM = 0.3;

/** a staining paint sinks in: it leaves this much less height at staining 1, so pickup and smudge take less */
export const STAIN = 0.6;
