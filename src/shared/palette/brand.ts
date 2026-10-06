// A palette of jobs from one brand colour, or from a seed: the seven roles (roles.ts), not a ramp.
// Neutrals carry a whisper of the brand hue, Text and Muted are BUILT to their contrast targets on
// both grounds, Accent and Highlight follow a harmony and keep their lightness apart from the
// brand colour. A colour in `locked` (the user's own) is never touched; the rest is derived from it.
// Pure and seeded: the same options always give the same palette.
import { contrast, type Oklch } from '../color/index.ts';
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

/** Text must clear WCAG AAA (7:1) and Muted AA (4.5:1) on Background and on Surface; each is built a little past it */
export const TEXT_RATIO = 7;
export const MUTED_RATIO = 4.5;
const MARGIN = 0.3;
/** Primary and Highlight are fills (3:1); Accent is a link (4.5:1) */
const FILL_RATIO = 3;
/** the value check flags values (Rec. 709 luma, color/value.ts) closer than 0.06: aim a little wider */
const GAP = 0.075;

export type BuildOptions = {
  seed: number;
  /** a style id; an unknown one is Quiet */
  style: string;
  accent: Accent;
  /** colours kept exactly as they are; every other role is derived around them */
  locked?: Partial<Record<Role, Oklch>>;
};

export function buildRoles(o: BuildOptions): RoleColours {
  const st = STYLES.find((s) => s.id === o.style) ?? STYLES[0];
  const lock = o.locked ?? {};
  const rnd = random(o.seed);
  const r = Array.from({ length: 12 }, () => rnd());
  const pick = r[0] < 0.5 ? 0 : 1;
  const side = r[1] < 0.5 ? -1 : 1;

  // the hue everything is built round: the brand colour's, or what a locked Accent implies, or the seed's
  const turns = harmony([0.6, 0.05, 0], o.accent === 'none' ? 'complementary' : o.accent).map((c) => c[2]);
  const accentTurn = o.accent === 'none' ? 0 : turns[pick % turns.length];
  const base = lock.Primary && lock.Primary[1] > 0.02 ? lock.Primary[2] : lock.Accent ? wrapHue(lock.Accent[2] - accentTurn) : r[2] * 360;

  const bgFor = (light: boolean): Oklch => {
    const [l, c, h] = [light ? 0.955 + 0.03 * r[3] : 0.15 + 0.05 * r[3], st.chroma * 0.8, neutralHue(base, st)];
    return fitChroma([l, c, h]);
  };
  // the style's ground, unless a locked Background says otherwise, or the brand colour cannot hold 3:1 on it
  let light = st.ground === 'light';
  if (lock.Background) light = lock.Background[0] > 0.6;
  else if (lock.Primary) {
    // against the harder of the two grounds: the page on light, the lifted card on dark
    const on = (l: boolean) => contrast(lock.Primary!, [l ? 0.97 : 0.23, 0, 0]);
    if (on(light) < FILL_RATIO && on(!light) > on(light)) light = !light;
  }

  const hue = lock.Background && lock.Background[1] > 0.003 ? lock.Background[2] : neutralHue(base, st);
  const cardFor = (b: Oklch): Oklch => fitChroma(light ? [b[0] < 0.972 ? 0.995 : b[0] - 0.035, st.chroma * 0.5, hue] : [b[0] + 0.05, st.chroma, hue]);
  let bg = lock.Background ?? bgFor(light);
  let surface = lock.Surface ?? cardFor(bg);
  // a mid-tone brand colour that barely holds 3:1 gets the whitest card on a toned page, not a greyer card
  if (light && lock.Primary && !lock.Background && !lock.Surface && Math.min(contrast(lock.Primary, bg), contrast(lock.Primary, surface)) < FILL_RATIO + 0.2) {
    bg = fitChroma([0.97, st.chroma * 0.8, hue]);
    surface = cardFor(bg);
  }
  const grounds = [bg, surface];

  const primary = lock.Primary ?? randomPrimary(grounds, light, base, st, r);
  const pV = valueOf(primary);

  const text = lock.Text ?? readable(grounds, light, TEXT_RATIO + MARGIN, hue, st.chroma * 1.5, light ? 0.15 + 0.08 * r[4] : 0.92 + 0.05 * r[4], [pV], light ? 0.08 : 0.985);
  const { accent: accentHue, highlight: highlightHue } = hues(base, o.accent, turns, pick, side);
  // Muted first, at the top of its band (a grey far enough from Text to tell apart), then Highlight and Accent in the room that is left: all keep their value apart
  const muted = lock.Muted ?? readable(grounds, light, MUTED_RATIO + MARGIN, hue, st.chroma * 1.3, NaN, [pV, valueOf(text)], light ? text[0] + 0.075 : text[0] - 0.075);
  const highlightC = clamp(0.05 + 0.12 * st.bold * (0.8 + 0.4 * r[6]), 0.06, 0.2);
  const highlight = lock.Highlight ?? readable(grounds, light, FILL_RATIO + MARGIN, highlightHue, highlightC, NaN, [pV, valueOf(text), valueOf(muted)], light ? 0.25 : 0.95);
  const accentC = clamp(0.045 + 0.13 * st.bold * (0.8 + 0.4 * r[5]), 0.07, 0.2);
  const accent = lock.Accent ?? readable(grounds, light, MUTED_RATIO + MARGIN, accentHue, accentC, NaN, [pV, valueOf(text), valueOf(muted), valueOf(highlight)], light ? 0.12 : 0.97);

  const made: RoleColours = { Background: bg, Surface: surface, Text: text, Muted: muted, Primary: primary, Accent: accent, Highlight: highlight };
  return Object.fromEntries(ROLES.map((role) => [role, [...(lock[role] ?? made[role])]])) as RoleColours;
}

/** the roles still missing from `have`, filled in around what is there (the palette's own colours never change) */
export function completeRoles(have: Partial<Record<Role, Oklch>>, o: Omit<BuildOptions, 'locked'>): { missing: Role[]; colours: RoleColours } {
  return { missing: ROLES.filter((role) => !have[role]), colours: buildRoles({ ...o, locked: have }) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** the brand hue pulled `pull` of the way (the short way round) to the style's lean */
function neutralHue(base: number, st: Style): number {
  if (st.lean === null) return base;
  const gap = ((st.lean - base + 540) % 360) - 180;
  return wrapHue(base + gap * st.pull);
}

/** the accent's and highlight's hues: the harmony's colours, one each; a one-colour harmony or None shifts the highlight beside the accent */
function hues(base: number, kind: Accent, turns: number[], pick: number, side: number): { accent: number; highlight: number } {
  if (kind === 'none') return { accent: base, highlight: wrapHue(base + 24 * side) };
  const t = turns.map((turn) => wrapHue(base + turn));
  return t.length === 2 ? { accent: t[pick], highlight: t[1 - pick] } : { accent: t[0], highlight: wrapHue(t[0] + 35 * side) };
}

/** a brand colour of the seed's own, light or dark enough to hold 3:1 on the grounds */
function randomPrimary(grounds: Oklch[], light: boolean, hue: number, st: Style, r: number[]): Oklch {
  const c = clamp(0.09 + 0.1 * st.bold * (0.8 + 0.4 * r[7]), 0.08, 0.2);
  return readable(grounds, light, FILL_RATIO + MARGIN, hue, c, light ? 0.52 + 0.1 * r[8] : 0.6 + 0.1 * r[8], [], light ? 0.4 : 0.9);
}

/**
 * A colour at `hue` and `chroma` that reads at `target` on every ground. Its lightness is the one
 * nearest `prefer` (the passing edge when NaN) in the band that passes, from `edge` to the limit,
 * that stays GAP clear, in value, of the values in `avoid` where the band has room. Chroma is cut to fit sRGB.
 */
function readable(grounds: Oklch[], light: boolean, target: number, hue: number, chroma: number, prefer: number, avoid: number[], edge: number): Oklch {
  const at = (l: number): Oklch => fitChroma([l, chroma, hue]);
  const ok = (l: number) => grounds.every((g) => contrast(at(l), g) >= target);
  // bisect from the end that always passes (black on a light ground) to the ground itself
  let [pass, fail] = light ? [0, Math.min(...grounds.map((g) => g[0]))] : [1, Math.max(...grounds.map((g) => g[0]))];
  for (let i = 0; i < 30; i++) {
    const mid = (pass + fail) / 2;
    if (ok(mid)) pass = mid;
    else fail = mid;
  }
  const limit = pass;
  // the band from the limit away from the ground as far as `edge`; none when `edge` is on the wrong side of the limit
  const [lo, hi] = light ? [Math.min(edge, limit), limit] : [limit, Math.max(edge, limit)];
  const want = Number.isNaN(prefer) ? (light ? limit - 0.015 : limit + 0.015) : prefer;
  let [best, apartBest, nearBest] = [limit, -1, -Infinity];
  for (let l = lo; l <= hi + 1e-9; l += 0.0025) {
    const v = valueOf(at(l));
    const apart = Math.min(GAP, ...avoid.map((a) => Math.abs(a - v)));
    const near = -Math.abs(l - want);
    if (apart > apartBest || (apart === apartBest && near > nearBest)) [best, apartBest, nearBest] = [l, apart, near];
  }
  return at(best);
}
