// Every tunable constant of the engine (plan §2, §3), each with what it does. Tuned on the stroke
// sheet (sheet.ts); the smoke checks hold the look to the thresholds in plan §6.

/** the paper, and how its relief is lit on screen only (never saved, never picked) */
export const PAPER = {
  /** bare paper, linear sRGB: a warm off-white, about #F1F0EA */
  rgb: [0.88, 0.87, 0.83] as const,
  /** how strongly the tooth is lit from the top left */
  relief: 0.38,
  /** the pulp's slow mottle, a little lighter and darker on screen (this much across its range): bare paper isn't a flat fill */
  mottle: 0.03,
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
  /** a click, a tap, a wobble or a short drag ends in a dab: a mouse's at tapPressure, a pen's at its own but not
   *  under tapFloor. A whole one while the travel is under tapTravel (a share of the size), then less and less of
   *  one, smoothly, until tapEnd, where the stroke itself is wide enough to end alone. Brush and stroke grow
   *  together, so the paint never drops as a drag lengthens */
  tapTravel: 0.5,
  tapEnd: 1.25,
  tapPressure: 0.85,
  tapFloor: 0.3,
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
  dry: { perPx: 0.25, min: 10, max: 50, hairs: 7 },
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
  /** a dab's length along the stroke, as a share of its width: a Flat's and a Dry brush's (a Round's is its disc) */
  tapLength: 0.3,
};

/** per brush and medium: hair edge hardness, streak length (px) and how much the streaks break the paint */
export const STREAKS = {
  wet: { hard: 0, length: 45, amount: 0.25 },
  gouache: { hard: 0.45, length: 26, amount: 0.55 },
  dry: { hard: 0.6, length: 14, amount: 0.75 },
};

/** paint load and its run-down */
export const LOAD = {
  /** px of travel a full hair lasts at size 40 (bigger brushes spend faster per px). At the defaults (size 80, Load 70)
   *  a stroke of either medium lasts about a canvas width, 2000 px, before it breaks up */
  gouache: 7500,
  wet: 2600,
  /** below this load gouache starts catching only the paper's peaks: gate = start - perLoad × load - perP × p */
  gateStart: 1.02,
  gateStartDry: 1.45,
  gatePerLoad: 1.5,
  gatePerP: 0.3,
};

/** pickup: what a gouache brush takes from the paint under it, and the smudge */
export const PICKUP = {
  /** per 12 px of travel */
  gouache: 0.08,
  smudge: 0.25,
  /** a smudge takes by the paint's height to this power, so a thin wash (low and pale) still moves;
   *  how much a hair can carry is this × its Strength */
  smudgeHeightPower: 0.5,
  smudgeHold: 1.7,
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
  /** the bristle amount a wash's leading edge (water, no hair yet) borrows: what the body has on average */
  headAmount: 0.75,
  /** the Dry brush's hair marks carry this many times a wash's thickness: hairs of paint, not a tint */
  dryBoost: 5,
  /** the paint's strength at the start of a stroke by its Load: floor + slope × load from the knee up
   *  (as Load 70 and 100 always were), and below it falling steeply, so a low Load is a pale wash */
  strength: { floor: 0.35, slope: 0.65, knee: 0.7, power: 1.8 },
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
  /** the carried paint is laid as its own colour at this thickness, which covers whatever is under it */
  cover: 60,
  /** how much of it a hair lays at full amount: an alpha, so a trail only thins and never shifts hue */
  alpha: 2,
  /** how fast the carried paint replaces what's in the film, per hair fragment */
  film: 0.7,
};

/** a palette colour's paint (tint 1, opacity 0.6) is weak beside a tube's, and a mix must not be bullied
 *  by it, so it is pushed this many times harder, per medium, at the stroke: one pass at Load 100 then
 *  lands on the swatch (watercolour within ΔE00 10 of it, gouache within 3) */
export const SWATCH = { wet: 48, dry: 6 };

/** how fast a paint hair's paint replaces what's in the film, per fragment (a constant-alpha blend) */
export const FILM = 0.3;

/** a staining paint sinks in: it leaves this much less height at staining 1, so pickup and smudge take less */
export const STAIN = 0.6;
