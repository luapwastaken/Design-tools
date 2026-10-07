// A palette of jobs from one brand colour, or from a seed: the seven roles (roles.ts), not a ramp.
// Neutrals carry a whisper of the brand hue and Text and Muted are BUILT to their contrast targets
// on both grounds. Accent is a lively second brand colour, a FILL (3:1 on the grounds) at the
// lightness where its hue holds the most chroma, a harmony turn (30 degrees or more) from the brand
// colour; Highlight is a clearly coloured marker fill that Text reads on. All keep their value apart
// from each other. A colour in `locked` (the user's own) is never touched; the rest is derived from it.
// One ground per build. Pure and seeded: the same options always give the same palette.
import { contrast, deltaE, simulateCvd, type Cvd, type Oklch } from '../color/index.ts';
import { valueOf } from '../color/value.ts';
import { harmony } from './harmony.ts';
import { random } from './random.ts';
import { ROLES, type Role } from './roles.ts';
import { fitChroma, wrapHue } from './space.ts';

export type Accent = 'analogous' | 'complementary' | 'split' | 'triad' | 'none';
export type RoleColours = Record<Role, Oklch>;

export const ACCENTS: { value: Accent; label: string }[] = [
  { value: 'analogous', label: 'Analogous' },
  { value: 'complementary', label: 'Complementary' },
  { value: 'split', label: 'Split complementary' },
  { value: 'triad', label: 'Triad' },
  { value: 'none', label: 'None' },
];

/**
 * What a style is: how the neutrals lean (a hue they are pulled towards and by how much), how much
 * colour they carry, how bold the accent is, and which ground the palette sits on. Ids and labels
 * are the generator's presets (generate.ts), so one choice serves both.
 */
type Style = {
  id: string;
  label: string;
  describe: string;
  ground: 'light' | 'dark';
  /** neutrals lean towards this hue; null = they keep the brand hue */
  lean: number | null;
  pull: number;
  /** neutral chroma */
  chroma: number;
  /** accent and highlight chroma, 0..1 */
  bold: number;
};

const STYLES: Style[] = [
  { id: 'quiet', label: 'Quiet', describe: 'Neutrals that only whisper the brand hue, a soft accent. Light ground.', ground: 'light', lean: null, pull: 0, chroma: 0.006, bold: 0.35 },
  { id: 'bold', label: 'Bold', describe: 'Clearly tinted neutrals and a strong accent. Light ground.', ground: 'light', lean: null, pull: 0, chroma: 0.012, bold: 1 },
  { id: 'warm', label: 'Warm', describe: 'Cream neutrals leaning warm whatever the brand hue. Light ground.', ground: 'light', lean: 70, pull: 0.65, chroma: 0.014, bold: 0.7 },
  { id: 'cool', label: 'Cool', describe: 'Blue-grey neutrals leaning cool whatever the brand hue. Light ground.', ground: 'light', lean: 255, pull: 0.65, chroma: 0.012, bold: 0.7 },
  { id: 'editorial', label: 'Editorial', describe: 'Paper and ink: an off-white page, near-black text, a restrained accent. Light ground.', ground: 'light', lean: 85, pull: 0.8, chroma: 0.01, bold: 0.55 },
  { id: 'tech', label: 'Tech', describe: 'Dark cool-grey ground and an electric accent. Goes light if your colour cannot hold 3:1 on dark.', ground: 'dark', lean: 260, pull: 0.6, chroma: 0.016, bold: 1.1 },
];

export const STYLE_LIST: { id: string; label: string; describe: string }[] = STYLES.map(({ id, label, describe }) => ({ id, label, describe }));

/** the ground a style builds on, before a brand colour that cannot hold 3:1 on it flips it */
export const styleGround = (id: string): 'light' | 'dark' => (STYLES.find((s) => s.id === id) ?? STYLES[0]).ground;

/** Text must clear WCAG AAA (7:1) and Muted AA (4.5:1) on Background and on Surface; each is built a little past it */
export const TEXT_RATIO = 7;
export const MUTED_RATIO = 4.5;
const MARGIN = 0.3;
/** Primary and Accent are fills (3:1 non-text); Text must read on Highlight (4.5:1) */
export const FILL_RATIO = 3;
export const ON_FILL_RATIO = 4.5;
/** the value check flags values (Rec. 709 luma, color/value.ts) closer than 0.06: aim a little wider */
const GAP = 0.075;

export type BuildOptions = {
  seed: number;
  /** a style id; an unknown one is Quiet */
  style: string;
  accent: Accent;
  /** colours kept exactly as they are; every other role is derived around them */
  locked?: Partial<Record<Role, Oklch>>;
  /** the ground to build on in place of the style's (a brand colour that cannot hold 3:1 on it still flips Auto) */
  ground?: 'light' | 'dark';
};

export function buildRoles(o: BuildOptions): RoleColours {
  const st = STYLES.find((s) => s.id === o.style) ?? STYLES[0];
  const lock = o.locked ?? {};
  const rnd = random(o.seed);
  const r = Array.from({ length: 16 }, () => rnd());
  const pick = r[0] < 0.5 ? 0 : 1;
  const side = r[1] < 0.5 ? -1 : 1;

  // the hue everything is built round: the brand colour's, or what a locked Accent implies, or the seed's
  const turns = harmony([0.6, 0.05, 0], o.accent === 'none' ? 'complementary' : o.accent).map((c) => (c[2] > 180 ? c[2] - 360 : c[2]));
  const accentTurn = o.accent === 'none' ? 0 : turns[pick % turns.length];
  const base = lock.Primary && lock.Primary[1] > 0.02 ? lock.Primary[2] : lock.Accent ? wrapHue(lock.Accent[2] - accentTurn) : r[2] * 360;

  const bgFor = (light: boolean): Oklch => {
    const [l, c, h] = [light ? 0.955 + 0.03 * r[3] : 0.15 + 0.05 * r[3], st.chroma * 0.8, neutralHue(base, st) + 10 * (r[10] - 0.5)];
    return fitChroma([l, c, wrapHue(h)]);
  };
  // the ground: a locked Background says it, then a locked Surface, Text or Muted (an ink lighter than the middle sits on a dark page);
  // else the asked ground or the style's, which a brand colour that cannot hold 3:1 on it flips
  let light = (o.ground ?? st.ground) === 'light';
  if (lock.Background) light = lock.Background[0] > 0.6;
  else if (lock.Surface) light = lock.Surface[0] > 0.6;
  else if (lock.Text) light = lock.Text[0] < 0.6;
  else if (lock.Muted) light = lock.Muted[0] < 0.62;
  else if (lock.Primary) {
    // against the harder of the two grounds: the page on light, the lifted card on dark
    const on = (l: boolean) => contrast(lock.Primary!, [l ? 0.97 : 0.23, 0, 0]);
    if (on(light) < FILL_RATIO && on(!light) > on(light)) light = !light;
  }

  const hue = lock.Background && lock.Background[1] > 0.003 ? lock.Background[2] : neutralHue(base, st);
  const cardFor = (b: Oklch): Oklch => fitChroma(light ? [b[0] < 0.972 ? 0.995 : b[0] - 0.035, st.chroma * 0.5, hue] : [b[0] + 0.05, st.chroma, hue]);
  let bg = lock.Background ?? (lock.Surface ? backing(lock.Surface, light, st, hue) : bgFor(light));
  let surface = lock.Surface ?? cardFor(bg);
  // a mid-tone brand colour that barely holds 3:1 gets the whitest card on a toned page, not a greyer card
  if (light && lock.Primary && !lock.Background && !lock.Surface && Math.min(contrast(lock.Primary, bg), contrast(lock.Primary, surface)) < FILL_RATIO + 0.2) {
    bg = fitChroma([0.97, st.chroma * 0.8, hue]);
    surface = cardFor(bg);
  }
  const grounds = [bg, surface];

  const primary = lock.Primary ?? randomPrimary(grounds, light, base, st, r);
  const pV = valueOf(primary);

  const highlightC = light ? clamp(0.05 + 0.05 * st.bold * (0.7 + 0.6 * r[6]), 0.05, 0.1) : clamp(0.1 + 0.05 * st.bold * (0.7 + 0.6 * r[6]), 0.1, 0.16);
  // Accent first, a lively fill; then Highlight, the marker Text reads on; then Muted in the room that is left: all keep their value apart
  const accentC = clamp(0.11 + 0.1 * st.bold * (0.7 + 0.6 * r[5]), 0.1, 0.22);
  // a harmony with two colours: the seed's pick, unless the other shows much more chroma on this page (yellows are olive at 3:1)
  const choose = (keep: number[]) => {
    const options = hues(base, o.accent, turns, pick, side, r[9]).map((h) => ({ ...h, accent: livelyNear(grounds, light, h, accentC, [pV, ...keep], r[11], r[12]) }));
    const [first, ...rest] = options;
    return rest.reduce((a, b) => (b.accent[1] > a.accent[1] * 1.25 ? b : a), first);
  };
  const readText = readable(grounds, light, TEXT_RATIO + MARGIN, hue, st.chroma * 1.5, light ? 0.15 + 0.08 * r[4] : 0.92 + 0.05 * r[4], [pV], light ? 0.08 : 0.985);
  // the Text is kept apart from a pale Primary, as far as a marker of the Highlight's hue can still be read on it
  const markerHue = (h: number) => (!light && (h < 125 || h > 340) ? 150 : h);
  const hl0 = markerHue(wrapHue(choose([valueOf(readText)]).highlight + 20 * (r[13] - 0.5)));
  const text = lock.Text ?? apartFrom(primary, grounds, light, readText, (c) => markerLs(c, grounds, light, markerBand(grounds, light, true), (l) => fitChroma([l, highlightC, hl0])).length > 0);
  // a Text moved off the Primary leaves the Muted a thin band beside it: its value is kept clear of the Accent too
  const chosen = choose(text === readText ? [valueOf(text)] : [valueOf(text), valueOf(text) + (light ? 0.09 : -0.09)]);
  const accent = lock.Accent ?? chosen.accent;
  // a deep marker on a dark page needs more chroma than a pastel on a light one, or it is dusty (highlightC)
  const highlight = lock.Highlight ?? marker(grounds, light, text, wrapHue(chosen.highlight + 20 * (r[13] - 0.5)), highlightC, [pV, valueOf(text), valueOf(accent)], r[8]);
  const muted = lock.Muted ?? readable(grounds, light, MUTED_RATIO + MARGIN, hue, st.chroma * 1.3, NaN, [pV, valueOf(text), valueOf(accent), valueOf(highlight)], light ? text[0] + 0.075 : text[0] - 0.075);

  const made: RoleColours = { Background: bg, Surface: surface, Text: text, Muted: muted, Primary: primary, Accent: accent, Highlight: highlight };
  return Object.fromEntries(ROLES.map((role) => [role, [...(lock[role] ?? made[role])]])) as RoleColours;
}

/** the roles still missing from `have`, filled in around what is there (the palette's own colours never change) */
export function completeRoles(have: Partial<Record<Role, Oklch>>, o: Omit<BuildOptions, 'locked'>): { missing: Role[]; colours: RoleColours } {
  return { missing: ROLES.filter((role) => !have[role]), colours: buildRoles({ ...o, locked: have }) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** a page for a locked card: the card's own lift undone, on the card's side */
function backing(card: Oklch, light: boolean, st: Style, hue: number): Oklch {
  return fitChroma(light ? [Math.min(0.985, card[0] - 0.03), st.chroma * 0.8, hue] : [Math.max(0.1, card[0] - 0.05), st.chroma, hue]);
}

/** the brand hue pulled `pull` of the way (the short way round) to the style's lean */
function neutralHue(base: number, st: Style): number {
  if (st.lean === null) return base;
  const gap = ((st.lean - base + 540) % 360) - 180;
  return wrapHue(base + gap * st.pull);
}

/**
 * The accent's and highlight's hues: the harmony's colours, one each, jittered by the seed (up to 15
 * degrees, always away from the brand colour for a close turn, so Accent stays 30 or more from it);
 * a one-colour harmony or None shifts the highlight beside the accent
 */
type Hues = { accent: number; highlight: number; /** how far the accent may slide to find more chroma, in degrees (only away from the brand colour when close to it) */ slide: number[] };
function hues(base: number, kind: Accent, turns: number[], pick: number, side: number, u: number): Hues[] {
  if (kind === 'none') return [{ accent: base, highlight: wrapHue(base + 24 * side), slide: [0] }];
  const near = (turn: number) => Math.abs(turn) < 90;
  const t = turns.map((turn) => wrapHue(base + turn + (near(turn) ? Math.sign(turn) * 15 * u : 15 * (2 * u - 1))));
  const slide = (turn: number) => (near(turn) ? [0, 10, 20, 30].map((d) => d * Math.sign(turn)) : [-30, -20, -10, 0, 10, 20, 30]);
  return t.length === 2
    ? [{ accent: t[pick], highlight: t[1 - pick], slide: slide(turns[pick]) }, { accent: t[1 - pick], highlight: t[pick], slide: slide(turns[1 - pick]) }]
    : [{ accent: t[0], highlight: wrapHue(t[0] + 35 * side), slide: slide(turns[0]) }];
}

/** a brand colour of the seed's own, light or dark enough to hold 3:1 on the grounds */
function randomPrimary(grounds: Oklch[], light: boolean, hue: number, st: Style, r: number[]): Oklch {
  const c = clamp(0.09 + 0.1 * st.bold * (0.8 + 0.4 * r[7]), 0.08, 0.2);
  return readable(grounds, light, FILL_RATIO + MARGIN, hue, c, light ? 0.52 + 0.1 * r[8] : 0.6 + 0.1 * r[8], [], light ? 0.4 : 0.9);
}

/** how unlike the Primary the built Text is, by CIEDE2000, under every colour vision: clear of the check's flag (10) */
export const TEXT_APART = 12;
const CVDS: Cvd[] = ['protan', 'deutan', 'tritan', 'achromat'];
/** the least ΔE between two colours as typical vision and each deficiency sees them */
export const leastApart = (a: Oklch, b: Oklch): number => Math.min(deltaE(a, b), ...CVDS.map((k) => deltaE(simulateCvd(a, k), simulateCvd(b, k))));

/**
 * The Text: `readable` at 7:1, then, where it would look like the Primary (a pale brand colour on a
 * dark page, both pale creams), the lightness in the passing band nearest the wanted one that is
 * `TEXT_APART` from it under every simulation, else the band's most distinct. Chroma stays a neutral's.
 */
function apartFrom(primary: Oklch, grounds: Oklch[], light: boolean, first: Oklch, feasible: (text: Oklch) => boolean): Oklch {
  if (leastApart(first, primary) >= TEXT_APART) return first;
  const [hue, chroma] = [first[2], first[1]];
  const at = (l: number): Oklch => fitChroma([l, chroma, hue]);
  const limit = edgeOf((l) => grounds.every((g) => contrast(at(l), g) >= TEXT_RATIO + MARGIN), light, grounds);
  const [lo, hi] = light ? [0, limit] : [limit, 1];
  // nearest the wanted lightness first: the first that clears TEXT_APART and leaves a marker wins; else the most distinct that does
  const ls: number[] = [];
  for (let l = lo; l <= hi + 1e-9; l += 0.005) ls.push(l);
  ls.sort((a, b) => Math.abs(a - first[0]) - Math.abs(b - first[0]));
  let [pick, pickApart] = [first, leastApart(first, primary)];
  for (const l of ls) {
    const c = at(l);
    const apart = leastApart(c, primary);
    if (apart >= TEXT_APART && feasible(c)) return c;
    if (apart > pickApart + 1e-9 && feasible(c)) [pick, pickApart] = [c, apart];
  }
  return pick;
}

/** the lightness (bisected) where `ok` stops holding, starting from the end that always passes */
function edgeOf(ok: (l: number) => boolean, light: boolean, grounds: Oklch[]): number {
  let [pass, fail] = light ? [0, Math.min(...grounds.map((g) => g[0]))] : [1, Math.max(...grounds.map((g) => g[0]))];
  for (let i = 0; i < 22; i++) {
    const mid = (pass + fail) / 2;
    if (ok(mid)) pass = mid;
    else fail = mid;
  }
  return pass;
}

/** the candidate that keeps GAP in value from `avoid` where one can, then scores best */
function best(ls: number[], at: (l: number) => Oklch, avoid: number[], score: (l: number, c: Oklch) => number): number {
  let [pick, apartBest, scoreBest] = [ls[0], -1, -Infinity];
  for (const l of ls) {
    const c = at(l);
    const v = valueOf(c);
    const apart = Math.min(GAP, ...avoid.map((a) => Math.abs(a - v)));
    const sc = score(l, c);
    if (apart > apartBest + 1e-9 || (Math.abs(apart - apartBest) <= 1e-9 && sc > scoreBest)) [pick, apartBest, scoreBest] = [l, apart, sc];
  }
  return pick;
}

/**
 * A colour at `hue` that reads at `target` on every ground. Its lightness is the one nearest `prefer`
 * (the passing edge when NaN) in the band that passes, from `edge` to the limit, that stays GAP
 * clear, in value, of the values in `avoid` where the band has room. Chroma is cut to fit sRGB.
 */
function readable(grounds: Oklch[], light: boolean, target: number, hue: number, chroma: number, prefer: number, avoid: number[], edge: number): Oklch {
  const at = (l: number): Oklch => fitChroma([l, chroma, hue]);
  const limit = edgeOf((l) => grounds.every((g) => contrast(at(l), g) >= target), light, grounds);
  // the band from the limit away from the ground as far as `edge`; none when `edge` is on the wrong side of the limit
  const [lo, hi] = light ? [Math.min(edge, limit), limit] : [limit, Math.max(edge, limit)];
  const want = Number.isNaN(prefer) ? (light ? limit - 0.015 : limit + 0.015) : prefer;
  const ls: number[] = [];
  for (let l = lo; l <= hi + 1e-9; l += 0.0025) ls.push(l);
  return at(ls.length ? best(ls, at, avoid, (l) => -Math.abs(l - want)) : limit);
}

/**
 * A lively fill: reads 3:1 (non-text) on every ground, at the lightness inside the passing band where
 * its hue shows the most chroma (not the darkest that passes, which is what makes browns and wines),
 * `u` (0..1) choosing where on the plateau.
 */
function lively(grounds: Oklch[], light: boolean, hue: number, chroma: number, avoid: number[], u: number): Oklch {
  const at = (l: number): Oklch => fitChroma([l, chroma, hue]);
  const limit = edgeOf((l) => grounds.every((g) => contrast(at(l), g) >= FILL_RATIO + MARGIN), light, grounds);
  // a little past the passing edge, not far: past the cusp a hue only gets darker and duller
  const reach = 0.12;
  const [lo, hi] = light ? [Math.max(0.25, limit - reach), limit] : [limit, Math.min(0.97, limit + reach)];
  const ls: number[] = [];
  for (let l = lo; l <= hi + 1e-9; l += 0.005) ls.push(l);
  if (!ls.length) return at(limit);
  const want = 0.05 + 0.7 * u;
  // how far into the band, 0 at the passing edge
  const into = (l: number) => (light ? limit - l : l - limit) / reach;
  return at(best(ls, at, avoid, (l, c) => c[1] / chroma - 0.5 * Math.abs(into(l) - want)));
}

/** the lively fill at the hue, or a few degrees along it where the hue shows clearly more chroma at its passing lightness (a yellow is olive at 3:1; an orange beside it is not) */
function livelyNear(grounds: Oklch[], light: boolean, h: Hues, chroma: number, avoid: number[], u: number, pickAmong: number): Oklch {
  // judged at the most chroma asked of any style, so a soft style slides to the lively hue too, then built at its own
  const tries = h.slide.map((d) => ({ d, score: lively(grounds, light, wrapHue(h.accent + d), 0.22, avoid, u)[1] - 0.0015 * Math.abs(d) }));
  const top = Math.max(...tries.map((t) => t.score));
  // the hues about as lively as the best: the seed chooses among them
  const near = tries.filter((t) => t.score >= top - 0.03);
  return lively(grounds, light, wrapHue(h.accent + near[Math.floor(pickAmong * near.length)].d), chroma, avoid, u);
}

/**
 * The lightness range a marker is searched in, on the ground's side of the palette and clear of both
 * grounds; `wide` closes up to the page a little more (the fallback when the Text is too dim for the
 * usual band, which a pale brand colour makes it).
 */
function markerBand(grounds: Oklch[], light: boolean, wide = false): [number, number] {
  const [gmin, gmax] = [Math.min(...grounds.map((g) => g[0])), Math.max(...grounds.map((g) => g[0]))];
  if (wide) return light ? [0.78, Math.max(0.8, Math.min(0.98, gmin - 0.07))] : [Math.min(0.5, Math.max(0.28, gmax + 0.07)), 0.56];
  return light ? [0.78, Math.max(0.8, Math.min(0.97, gmin - 0.125))] : [Math.min(0.5, Math.max(0.34, gmax + 0.125)), 0.56];
}

/** the lightnesses in a band where a marker of this hue and chroma reads under `text` and keeps GAP in value from the grounds */
function markerLs(text: Oklch, grounds: Oklch[], light: boolean, band: [number, number], at: (l: number) => Oklch): number[] {
  const gv = grounds.map(valueOf);
  const ls: number[] = [];
  for (let l = band[0]; l <= band[1] + 1e-9; l += 0.005) {
    const v = valueOf(at(l));
    if (contrast(text, at(l)) >= ON_FILL_RATIO + MARGIN && (light ? v <= Math.min(...gv) - GAP : v >= Math.max(...gv) + GAP)) ls.push(l);
  }
  return ls;
}

/**
 * A marker: a clearly coloured fill on the ground's side of the palette (light on a light page, deep
 * on a dark one) that Text reads on at 4.5:1 and that stays GAP apart in value from both grounds,
 * so it shows as a marker and not as more page.
 */
function marker(grounds: Oklch[], light: boolean, text: Oklch, wanted: number, chroma: number, avoid: number[], u: number): Oklch {
  // deep, a warm hue is brown, olive or wine: on a dark page the marker takes the green-teal instead
  const hue = !light && (wanted < 125 || wanted > 340) ? 150 : wanted;
  const at = (l: number): Oklch => fitChroma([l, chroma, hue]);
  // far enough from the page in lightness (0.125) that it still reads as a marker under colour-blind simulations and in greyscale
  let [lo, hi] = markerBand(grounds, light);
  let ls = markerLs(text, grounds, light, [lo, hi], at);
  if (!ls.length) {
    [lo, hi] = markerBand(grounds, light, true);
    ls = markerLs(text, grounds, light, [lo, hi], at);
  }
  if (!ls.length) return at(light ? 0.86 : 0.42);
  // a pastel on a light page, a bright-ish tint (the upper part of its range) on a dark one: the deep end of the range is wine and brown
  const want = light ? 0.2 + 0.6 * u : 0.6 + 0.4 * u;
  const span = hi - lo;
  return at(best(ls, at, avoid, (l, c) => c[1] / chroma - 0.4 * Math.abs((light ? hi - l : l - lo) / span - want)));
}
