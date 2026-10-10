// Variations grid: six whole palettes at once, for Design (7 roles) and Illustration (ramps), plus the
// add-ons that go with it: close relatives of one cell, alternatives for one colour, a whole set of ramps.
// Pure and seeded: the same inputs give the same cells, so a view only needs to save the seed.
//   - Design: every cell is buildRoles with its own seed, style, accent and ground; locked roles are
//     handed to buildRoles, so they are identical in every cell.
//   - Illustration: "vary the colours" makes whole sets of bases (limited sets, subject mixes,
//     generator presets) developed under the CURRENT light; "vary the light" keeps the bases and
//     changes only the light pair.
// Spec: docs/superpowers/specs/2026-10-10-variations.md
import { contrast, deltaE, toHex, type Oklch } from '../color/index.ts';
import { holdValue, valueOf } from '../color/value.ts';
import { LIGHTS, SETS, SUBJECTS, type LightPair } from '../../renderer/tools/illustration/scene.ts';
import type { MaterialId, RampSpec } from '../types.ts';
import { buildRoles, FILL_RATIO, MUTED_RATIO, ON_FILL_RATIO, STYLE_LIST, TEXT_RATIO, type Accent, type RoleColours } from './brand.ts';
import { generate, PRESETS } from './generate.ts';
import { random } from './random.ts';
import { generateRamp, newRamp } from './ramp.ts';
import { ROLES, type Role } from './roles.ts';
import { fitChroma, wrapHue } from './space.ts';

export const COUNT = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function shuffled<T>(list: T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** the grid's next seed: a six-digit number, so it reads well in mono */
export const nextSeed = (seed: number): number => 100000 + Math.floor(random(seed)() * 900000);

// ── Design ──────────────────────────────────────────────────────────────────────────────────────

export type Ground = 'light' | 'dark';
export type DesignVary = { style: boolean; accent: boolean; ground: boolean };
export type DesignCurrent = { style: string; accent: Accent; ground: Ground };
export type Checks = { passed: number; total: number; fails: string[]; text: number };
export type DesignCell = { n: number; seed: number; style: string; accent: Accent; ground: Ground; label: string; roles: RoleColours; checks: Checks };

const ACCENT_POOL: Accent[] = ['analogous', 'complementary', 'split', 'triad'];
export const ACCENT_SHORT: Record<Accent, string> = { analogous: 'Analogous', complementary: 'Opposite', split: 'Split', triad: 'Triad', none: 'None' };
const styleLabel = (id: string) => STYLE_LIST.find((s) => s.id === id)?.label ?? id;

export const groundOf = (r: RoleColours): Ground => (r.Background[0] > 0.6 ? 'light' : 'dark');
export const rolesKey = (r: RoleColours): string => ROLES.map((k) => toHex(r[k])).join(' ');

export type Pair = { name: string; fg: Role; bg: Role; need: number; ratio: number; pass: boolean };
const PAIRS: [Role, Role, number][] = [
  ['Text', 'Background', TEXT_RATIO], ['Text', 'Surface', TEXT_RATIO], ['Muted', 'Background', MUTED_RATIO], ['Muted', 'Surface', MUTED_RATIO],
  ['Primary', 'Background', FILL_RATIO], ['Primary', 'Surface', FILL_RATIO], ['Accent', 'Background', FILL_RATIO], ['Accent', 'Surface', FILL_RATIO], ['Text', 'Highlight', ON_FILL_RATIO],
];

/** the role pairs buildRoles promises: Text 7:1 and Muted 4.5:1 on both grounds, fills 3:1, Text 4.5:1 on Highlight.
 *  A hex is what ships, so a pair is judged on the rounded colours (a hair under the target is a fail). */
export function pairsOf(r: RoleColours): Pair[] {
  return PAIRS.map(([fg, bg, need]) => {
    const ratio = contrast(toHex(r[fg]), toHex(r[bg]));
    return { name: `${fg} on ${bg}`, fg, bg, need, ratio, pass: ratio >= need - 0.005 };
  });
}
/** the pairs one role takes part in */
export const roleChecks = (r: RoleColours, role: Role): Pair[] => pairsOf(r).filter((p) => p.fg === role || p.bg === role);

export function checkRoles(r: RoleColours): Checks {
  const ok = pairsOf(r);
  return {
    passed: ok.filter((x) => x.pass).length,
    total: ok.length,
    fails: ok.filter((x) => !x.pass).map((x) => x.name),
    text: Math.min(contrast(toHex(r.Text), toHex(r.Background)), contrast(toHex(r.Text), toHex(r.Surface))),
  };
}

/**
 * Six palettes. `locked` roles are identical in every cell. What may change is `vary`: the style, the
 * accent harmony and the ground (light or dark); what may not stays at `current`. Cells are all
 * different: a cell that repeats another is made again from a new sub-seed.
 */
export function designCells(o: { seed: number; locked: Partial<Record<Role, Oklch>>; vary: DesignVary; current: DesignCurrent; count?: number }): DesignCell[] {
  const count = o.count ?? COUNT;
  const master = random(o.seed);
  const styles = shuffled(STYLE_LIST.map((s) => s.id), master);
  const accents = shuffled(ACCENT_POOL, master);
  const grounds = shuffled(Array.from({ length: count }, (_, i): Ground => (i % 3 === 1 ? 'dark' : 'light')), master);
  const seen = new Set<string>();
  const cells: DesignCell[] = [];
  for (let i = 0; i < count; i++) {
    const style = o.vary.style ? styles[i % styles.length] : o.current.style;
    const accent = o.vary.accent ? accents[(i + Math.floor(i / accents.length)) % accents.length] : o.current.accent;
    const ground = o.vary.ground ? grounds[i] : o.current.ground;
    let seed = Math.floor(master() * 2 ** 31);
    let roles = buildRoles({ seed, style, accent, locked: o.locked, ground });
    for (let tries = 0; tries < 12 && seen.has(rolesKey(roles)); tries++) {
      seed += 7919;
      roles = buildRoles({ seed, style, accent, locked: o.locked, ground });
    }
    seen.add(rolesKey(roles));
    cells.push({ n: i + 1, seed, style, accent, ground: groundOf(roles), label: `${styleLabel(style)} · ${ACCENT_SHORT[accent]}`, roles, checks: checkRoles(roles) });
  }
  return cells;
}

// ── Illustration ────────────────────────────────────────────────────────────────────────────────

export type Base = { name: string; base: Oklch; material: MaterialId; locked?: boolean };
export type Ramp = { name: string; material: MaterialId; base: Oklch; steps: { step: number; oklch: Oklch }[] };
export type ColourKind = 'set' | 'subjects' | 'preset' | 'picture';
export type ColourCell = { n: number; kind: ColourKind; label: string; detail: string; bases: Base[]; light: LightPair };
export type LightCell = { n: number; label: string; detail: string; bases: Base[]; light: LightPair; presetId: string | null };

/**
 * The ramps a list of bases develops into under a light. They are the scene's own: `like` (a ramp of
 * the scene) lends its intensity, push, steps, hue shift and chroma curve, as newRamp does for a ramp
 * that joins it; each base keeps its own material.
 */
export function rampsFor(bases: Base[], light: LightPair, like?: RampSpec | null): Ramp[] {
  return bases.map((b, i) => {
    const spec: RampSpec = {
      ...newRamp(b.base, `${b.name}-${i}`, like),
      light: [...light.light],
      shadow: [...light.shadow],
      material: b.material,
      hueShift: like?.hueShift ?? 0,
      chromaCurve: like?.chromaCurve ?? 0,
    };
    return { name: b.name, material: b.material, base: b.base, steps: generateRamp(spec) };
  });
}

export const basesKey = (bases: Base[]): string => bases.map((b) => `${toHex(b.base)}/${b.material}`).join(' ');
export const lightKey = (p: LightPair): string => `${toHex(p.light)} ${toHex(p.shadow)}`;
export const sameLightPair = (a: LightPair, b: LightPair): boolean => lightKey(a) === lightKey(b);

const MATS: MaterialId[] = ['paper', 'cloth', 'wood', 'foliage', 'stone', 'fur'];
const GROUPS: string[][] = [
  ['skin-light', 'skin', 'skin-deep'],
  ['hair-blonde', 'hair', 'hair-black', 'hair-red'],
  ['foliage'],
  ['sky'],
  ['cloth'],
  ['metal'],
  ['stone'],
  ['wood'],
  ['water'],
];

/** `k` of the list, evenly spread from first to last (the whole list when it is short enough) */
function spread<T>(list: T[], k: number): T[] {
  if (k >= list.length) return list;
  if (k <= 1) return list.slice(0, 1);
  return Array.from({ length: k }, (_, i) => list[Math.round((i * (list.length - 1)) / (k - 1))]);
}

/** exactly `k` bases: topped up from SUBJECTS when the recipe made too few, spread when it made too many */
function fill(list: Base[], k: number, seed: number): Base[] {
  if (k <= 0) return [];
  const out = [...list];
  const extra = shuffled(SUBJECTS, random(seed + 1));
  for (let i = 0; out.length < k && i < extra.length; i++) out.push({ name: extra[i].label, base: extra[i].base, material: extra[i].material });
  return spread(out, k);
}

function madeBases(kind: ColourKind, seed: number, hues: Oklch[], want: number): { label: string; detail: string; bases: Base[] } {
  const rnd = random(seed);
  if (kind === 'set') {
    const set = SETS[Math.floor(rnd() * SETS.length)];
    const hue = rnd() * 360;
    const offset = Math.floor(rnd() * MATS.length);
    const bases = set.make(hue).map((base, i): Base => ({ name: `${set.label} ${i + 1}`, base, material: MATS[(i + offset) % MATS.length] }));
    return { label: set.label, detail: set.usesHue ? `Colours built round one hue (${Math.round(hue)}°)` : 'Fixed earth colours', bases };
  }
  if (kind === 'subjects') {
    const byId = (id: string) => SUBJECTS.find((s) => s.id === id)!;
    const pickOf = (g: string[]) => byId(g[Math.floor(rnd() * g.length)]);
    const rest = shuffled(GROUPS.slice(2), rnd).slice(0, Math.max(1, want - 2));
    const chosen = [pickOf(GROUPS[0]), pickOf(GROUPS[1]), ...rest.map(pickOf)];
    return { label: 'Subjects mix', detail: chosen.map((s) => s.label).join(' · '), bases: chosen.map((s): Base => ({ name: s.label, base: s.base, material: s.material })) };
  }
  const preset = PRESETS[Math.floor(rnd() * PRESETS.length)];
  const made = generate({ seed, count: 5, preset: preset.id, locked: [], hues }).reverse(); // lightest first
  const offset = Math.floor(rnd() * MATS.length);
  return { label: `${preset.label} preset`, detail: 'Five colours, evenly light to dark', bases: made.map((base, i): Base => ({ name: `${preset.label} ${i + 1}`, base, material: MATS[(i + offset) % MATS.length] })) };
}

/**
 * Six whole palettes of bases, each shown under `light` (the current one). Locked bases are in every
 * cell, at their place in the list; the rest come from the cell's recipe, shaped to the same count.
 */
export function colourCells(o: { seed: number; current: Base[]; light: LightPair; count?: number; subjects?: string[] }): ColourCell[] {
  const count = o.count ?? COUNT;
  const master = random(o.seed);
  if (o.subjects?.length) return pictureCells({ ...o, subjects: o.subjects, count }, master);
  const kinds = shuffled(Array.from({ length: count }, (_, i): ColourKind => (['set', 'subjects', 'preset'] as const)[i % 3]), master);
  const locked = o.current.flatMap((b, i) => (b.locked ? [{ b, i }] : []));
  const want = Math.max(1, o.current.length);
  const hues = locked.map((x) => x.b.base);
  const seen = new Set<string>();
  const cells: ColourCell[] = [];
  for (let i = 0; i < count; i++) {
    let seed = Math.floor(master() * 2 ** 31);
    let made = madeBases(kinds[i], seed, hues, want);
    const build = () => {
      const free = fill(made.bases, Math.max(0, want - locked.length), seed);
      locked.forEach(({ b, i: at }) => free.splice(Math.min(at, free.length), 0, { ...b }));
      // every cell has the scene's slots: same names and materials, so adopting a cell keeps the roles
      return free.map((b, k) => (b.locked ? b : o.current[k] ? { ...b, name: o.current[k].name, material: o.current[k].material } : b));
    };
    let bases = build();
    for (let tries = 0; tries < 12 && seen.has(basesKey(bases)); tries++) {
      seed += 7919;
      made = madeBases(kinds[i], seed, hues, want);
      bases = build();
    }
    seen.add(basesKey(bases));
    cells.push({ n: i + 1, kind: kinds[i], label: made.label, detail: made.detail, bases, light: o.light });
  }
  return cells;
}

/** a light pair nudged: hues turned 15 to 30 degrees (the two the opposite way), lightness and chroma shifted a little; `scale` shrinks all of it */
export function jitterLight(p: LightPair, seed: number, scale = 1): LightPair {
  const rnd = random(seed);
  const turn = (rnd() < 0.5 ? -1 : 1) * (15 + 15 * rnd()) * scale;
  const move = (c: Oklch, k: number): Oklch => fitChroma([clamp(c[0] + (rnd() - 0.5) * 0.08 * scale, 0.15, 0.99), c[1] * (1 + (0.6 * rnd() - 0.3) * scale), wrapHue(c[2] + turn * k)]);
  return { light: move(p.light, 1), shadow: move(p.shadow, -1) };
}

/**
 * Which presets get a cell. Six cells cannot hold all eight lights, so: the five that differ most (greedy
 * farthest-first on the light colour's plus the shadow colour's CIEDE2000, starting from the widest pair),
 * kept in the order of LIGHTS so the numbers stay learnable; the sixth cell is an in-between light, a preset
 * of the three that missed out, nudged by the seed. Space renews only that one.
 */
const lightApart = (a: LightPair, b: LightPair) => deltaE(a.light, b.light) + deltaE(a.shadow, b.shadow);
const FIVE = (() => {
  let best: [number, number] = [0, 1];
  for (let a = 0; a < LIGHTS.length; a++) for (let b = a + 1; b < LIGHTS.length; b++) if (lightApart(LIGHTS[a], LIGHTS[b]) > lightApart(LIGHTS[best[0]], LIGHTS[best[1]])) best = [a, b];
  const chosen = new Set<number>(best);
  while (chosen.size < 5) {
    let pick = -1;
    let reach = -1;
    LIGHTS.forEach((l, i) => {
      if (chosen.has(i)) return;
      const near = Math.min(...[...chosen].map((j) => lightApart(l, LIGHTS[j])));
      if (near > reach) [pick, reach] = [i, near];
    });
    chosen.add(pick);
  }
  return LIGHTS.filter((_, i) => chosen.has(i));
})();
const LEFT_OUT = LIGHTS.filter((l) => !FIVE.includes(l));
export const LIGHT_PRESETS = FIVE;

/** The same scene under five light presets and one in-between light. Bases never change. */
export function lightCells(o: { seed: number; bases: Base[]; current: LightPair }): LightCell[] {
  const rnd = random(o.seed);
  const from = LEFT_OUT[Math.floor(rnd() * LEFT_OUT.length)];
  const cells: LightCell[] = FIVE.map((l, i) => ({ n: i + 1, label: l.label, detail: 'preset', bases: o.bases, light: { light: [...l.light], shadow: [...l.shadow] }, presetId: l.id }));
  cells.push({ n: FIVE.length + 1, label: `${from.label}, nudged`, detail: 'in between', bases: o.bases, light: jitterLight(from, Math.floor(rnd() * 2 ** 31)), presetId: null });
  return cells;
}

// ── Illustration: what is in the picture ─────────────────────────────────────────────────────────

export type Kind = { kind: string; label: string; tones?: { id: string; label: string }[] };
/** the subjects a scene can be ticked from, in the order their ramps are made; the tone ids are SUBJECTS ids */
export const KINDS: Kind[] = [
  { kind: 'skin', label: 'Skin', tones: [{ id: 'skin-light', label: 'Light' }, { id: 'skin', label: 'Medium' }, { id: 'skin-deep', label: 'Deep' }] },
  { kind: 'hair', label: 'Hair', tones: [{ id: 'hair-blonde', label: 'Blonde' }, { id: 'hair', label: 'Brown' }, { id: 'hair-black', label: 'Black' }, { id: 'hair-red', label: 'Red' }] },
  ...['cloth', 'foliage', 'sky', 'stone', 'wood', 'water', 'metal'].map((k): Kind => ({ kind: k, label: SUBJECTS.find((s) => s.id === k)!.label })),
];
const kindOf = (id: string) => KINDS.find((k) => k.kind === id || k.tones?.some((t) => t.id === id))!;

/** the SUBJECTS ids of what is ticked, in KINDS order, each skin or hair at its chosen tone */
export function pickedIds(on: Iterable<string>, tones: Record<string, string>): string[] {
  const set = new Set(on);
  return KINDS.filter((k) => set.has(k.kind)).map((k) => (k.tones ? (k.tones.find((t) => t.id === tones[k.kind]) ?? k.tones[Math.floor(k.tones.length / 2)]).id : k.kind));
}

const subjectOf = (id: string) => SUBJECTS.find((s) => s.id === id)!;

/** one base per subject, in the order given, each with its own material: what "Make ramps" starts the scene from */
export const subjectBases = (ids: string[]): Base[] => ids.map((id) => ({ name: subjectOf(id).label, base: [...subjectOf(id).base] as Oklch, material: subjectOf(id).material }));

/** the hues a subject may take when it varies (cloth takes any); skin and hair vary by tone instead */
const HUES: Record<string, [number, number]> = { cloth: [0, 360], foliage: [95, 170], sky: [205, 262], stone: [30, 110], wood: [30, 80], water: [185, 245], metal: [235, 290] };

/** a subject made again: skin and hair take another tone and a small nudge; the rest take a new hue in their range, a new chroma and a value close to the original */
function variedSubject(id: string, rnd: () => number): Base {
  const k = kindOf(id);
  const tone = k.tones ? subjectOf(k.tones[Math.floor(rnd() * k.tones.length)].id) : subjectOf(id);
  const [, c, h] = tone.base;
  const v = clamp(valueOf(tone.base) + (rnd() - 0.5) * (k.tones ? 0.05 : 0.14), 0.05, 0.95);
  const [lo, hi] = HUES[k.kind] ?? [h - 8, h + 8];
  const hue = k.tones ? wrapHue(h + (rnd() - 0.5) * 16) : wrapHue(lo + rnd() * (hi - lo));
  const chroma = k.tones ? c * (0.85 + 0.3 * rnd()) : k.kind === 'metal' ? 0.01 + 0.03 * rnd() : Math.max(0.03, c * (0.7 + 0.8 * rnd()));
  return { name: tone.label, base: holdValue(v, chroma, hue), material: tone.material };
}

/** colour cells that keep the subject list: one base per ticked subject, varied within the subject; locked slots stay */
function pictureCells(o: { seed: number; current: Base[]; light: LightPair; subjects: string[]; count: number }, master: () => number): ColourCell[] {
  const seen = new Set<string>();
  const cells: ColourCell[] = [];
  for (let i = 0; i < o.count; i++) {
    let bases: Base[] = [];
    for (let tries = 0; tries < 12; tries++) {
      const rnd = random(Math.floor(master() * 2 ** 31));
      bases = o.subjects.map((id, k) => (o.current[k]?.locked ? { ...o.current[k] } : variedSubject(id, rnd)));
      if (!seen.has(basesKey(bases))) break;
    }
    seen.add(basesKey(bases));
    cells.push({ n: i + 1, kind: 'picture', label: 'This picture', detail: bases.map((b) => b.name).join(' · '), bases, light: o.light });
  }
  return cells;
}

// ── More like this: close relatives of one cell ──────────────────────────────────────────────────

export type Parent = DesignCell | ColourCell | LightCell;

/** keep this many of the seven roles: 4 at depth 1, 5 at depth 2, 6 from depth 3 */
const keepAt = (depth: number) => Math.min(6, 3 + Math.max(1, depth));

/**
 * The cell you narrowed from as cell 1, then five close relatives. `depth` is how many times "More like
 * this" has been pressed (1 the first time); each step narrows the spread.
 *   - Design: the cell's style, accent and ground stay. Primary (the colour the palette is built round),
 *     every user lock and a few more roles are kept exactly; the rest are built again by buildRoles from new seeds.
 *   - Illustration, colours: the light stays; each unlocked base turns a little in hue and chroma at the SAME
 *     value (holdValue), by half as much at each step.
 *   - Illustration, light: the light pair turns a little (jitterLight), by half as much at each step.
 * Every relative differs from the others and from the parent. With nothing free to vary the row is the
 * parent alone, and a narrow spread may come back short rather than padded with copies.
 */
export function relatives(cell: DesignCell, depth: number, seed: number, o?: { locks?: Role[]; count?: number }): DesignCell[];
export function relatives(cell: ColourCell, depth: number, seed: number, o?: { count?: number }): ColourCell[];
export function relatives(cell: LightCell, depth: number, seed: number, o?: { count?: number }): LightCell[];
export function relatives(cell: Parent, depth: number, seed: number, o: { locks?: Role[]; count?: number } = {}): Parent[] {
  const count = (o.count ?? COUNT) - 1;
  const rnd = random(seed);
  const d = Math.max(1, Math.round(depth));
  if ('roles' in cell) {
    const anchor = new Set<Role>(['Primary', ...(o.locks ?? [])]);
    const seen = new Set<string>([rolesKey(cell.roles)]);
    const out: DesignCell[] = [{ ...cell, n: 1 }];
    for (let i = 0; i < count; i++) {
      let made: DesignCell | null = null;
      for (let tries = 0; tries < 30 && !made; tries++) {
        // after many misses keep one fewer: a narrow spread may have too few roles left to differ
        const keep = Math.max(anchor.size, keepAt(d) - Math.floor(tries / 10));
        const kept = new Set(anchor);
        for (const r of shuffled(ROLES.filter((x) => !anchor.has(x)), rnd)) if (kept.size < keep) kept.add(r);
        const locked = Object.fromEntries([...kept].map((r) => [r, cell.roles[r]])) as Partial<Record<Role, Oklch>>;
        const s = Math.floor(rnd() * 2 ** 31);
        const roles = buildRoles({ seed: s, style: cell.style, accent: cell.accent, locked, ground: cell.ground });
        if (seen.has(rolesKey(roles))) continue;
        const checks = checkRoles(roles);
        // a parent that passes every pair gets relatives that do, where the builder can manage it
        if (cell.checks.passed === cell.checks.total && checks.passed < checks.total && tries < 20) continue;
        made = { n: out.length + 1, seed: s, style: cell.style, accent: cell.accent, ground: groundOf(roles), label: `${cell.label.split(' · ').slice(0, 2).join(' · ')} · ${ROLES.filter((r) => toHex(roles[r]) !== toHex(cell.roles[r])).join(', ')} changed`, roles, checks };
      }
      if (!made) break; // everything is locked: there is nothing to vary
      seen.add(rolesKey(made.roles));
      out.push(made);
    }
    return out;
  }
  if ('kind' in cell) {
    const scale = 0.5 ** (d - 1);
    const seen = new Set<string>([basesKey(cell.bases)]);
    const out: ColourCell[] = [{ ...cell, n: 1 }];
    if (cell.bases.every((b) => b.locked)) return out; // every ramp is locked: nothing to vary
    for (let i = 0; i < count; i++) {
      // a collision widens the nudge a little rather than padding the row with copies; a row may come back short
      for (let tries = 0; tries < 24; tries++) {
        const wide = scale * (1 + tries * 0.25);
        let most = '';
        let far = -1;
        const bases = cell.bases.map((b): Base => {
          if (b.locked) return { ...b };
          const turn = (rnd() < 0.5 ? -1 : 1) * (0.4 + 0.6 * rnd()) * 30 * wide;
          const chroma = b.base[1] * (1 + (rnd() < 0.5 ? -1 : 1) * (0.4 + 0.6 * rnd()) * 0.35 * wide);
          if (Math.abs(turn) > far) { far = Math.abs(turn); most = b.name; }
          return { ...b, base: holdValue(valueOf(b.base), chroma, wrapHue(b.base[2] + turn)) };
        });
        if (seen.has(basesKey(bases))) continue;
        seen.add(basesKey(bases));
        out.push({ ...cell, n: out.length + 1, label: `${most} turned most`, detail: 'Hue and chroma nudged, same grey values', bases });
        break;
      }
    }
    return out;
  }
  const seen = new Set<string>([lightKey(cell.light)]);
  const out: LightCell[] = [{ ...cell, n: 1 }];
  const root = cell.label.replace(/, nudged$/, '');
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const light = jitterLight(cell.light, Math.floor(rnd() * 2 ** 31), 0.5 ** d * (1 + tries * 0.25));
      if (seen.has(lightKey(light))) continue;
      seen.add(lightKey(light));
      out.push({ n: out.length + 1, label: `${root}, nudged`, detail: 'light turned a little', bases: cell.bases, light, presetId: null });
      break;
    }
  }
  return out;
}

// ── Swap one colour: alternatives that still fit ─────────────────────────────────────────────────

/** two colours closer than this (CIEDE2000) read as the same */
const APART = 2;
const PLURAL: Record<Role, string> = { Background: 'Backgrounds', Surface: 'Surfaces', Text: 'Text colours', Muted: 'Muted colours', Primary: 'Primaries', Accent: 'Accents', Highlight: 'Highlights' };
const NEEDS: Record<Role, string> = {
  Background: 'every pair on it still passes',
  Surface: 'every pair on it still passes',
  Text: 'each still passes 7:1 on both backgrounds and 4.5:1 on Highlight',
  Muted: 'each still passes 4.5:1 on both backgrounds',
  Primary: 'each still passes 3:1 on both backgrounds',
  Accent: 'each still passes 3:1 on both backgrounds',
  Highlight: 'Text still passes 4.5:1 on each',
};
/** the line above the alternatives: "Other Accents that fit: each still passes 3:1 on both backgrounds" */
export const altsTitle = (role: Role): string => `Other ${PLURAL[role]} that fit: ${NEEDS[role]}`;

export type DesignAlt = { colour: Oklch; hex: string; /** the least ratio over the pairs this role is in */ figure: number };
export type RampAlt = { base: Oklch; hex: string; steps: Ramp['steps'] };

/**
 * About eight other colours for one role. buildRoles gives them with every OTHER role locked to the current
 * palette, from varied seeds and accent harmonies; a sweep of lightness, hue and chroma round the colour tops
 * up the row when the builder has few answers (the neutrals). Each one must pass every pair its role is in
 * (the same checks as checkRoles, on the hex that ships) and sit clear of the others and of the current colour.
 */
export function designAlternatives(o: { seed: number; role: Role; roles: RoleColours; style: string; accent: Accent; count?: number }): DesignAlt[] {
  const count = o.count ?? 8;
  const cur = o.roles[o.role];
  const rnd = random(o.seed * 31 + ROLES.indexOf(o.role) + 1);
  const others = Object.fromEntries(ROLES.filter((k) => k !== o.role).map((k) => [k, o.roles[k]])) as Partial<Record<Role, Oklch>>;
  const out: DesignAlt[] = [];
  const take = (c: Oklch) => {
    if (out.length >= count || c.some((v) => !Number.isFinite(v))) return;
    const checks = roleChecks({ ...o.roles, [o.role]: c }, o.role);
    if (!checks.every((p) => p.pass)) return;
    if (deltaE(c, cur) < APART || out.some((a) => deltaE(c, a.colour) < APART)) return;
    out.push({ colour: c, hex: toHex(c), figure: Math.min(...checks.map((p) => p.ratio)) });
  };
  const pool: Accent[] = [o.accent === 'none' ? 'triad' : o.accent, ...ACCENT_POOL];
  for (let t = 0; t < 48 && out.length < count; t++) {
    take(buildRoles({ seed: Math.floor(rnd() * 2 ** 31), style: o.style, accent: pool[t % pool.length], locked: others, ground: groundOf(o.roles) })[o.role]);
  }
  if (out.length < count) {
    const [l, c, h] = cur;
    const sweep: Oklch[] = [];
    for (const dl of [-0.12, -0.06, 0.06, 0.12]) for (const dh of [-90, -45, -20, 20, 45, 90, 180]) for (const f of [0.6, 1.5]) sweep.push(fitChroma([clamp(l + dl, 0.05, 0.99), Math.max(0.02, c * f), wrapHue(h + dh)]));
    for (const c2 of shuffled(sweep, rnd)) take(c2);
  }
  return out;
}

/**
 * About eight other colours for one ramp's base, at the same grey value: six spread round the wheel and four
 * near the current hue, each held at the base's valueOf (holdValue) and shown as its own ramp under `light`.
 * Listed by how far their hue is round from the current one, so the row reads as a wheel.
 */
export function rampAlternatives(o: { seed: number; base: Base; light: LightPair; like?: RampSpec | null; count?: number }): RampAlt[] {
  const count = o.count ?? 8;
  const rnd = random(o.seed * 17 + 5);
  const [, c, h] = o.base.base;
  const v = valueOf(o.base.base);
  const start = rnd() * 60;
  const cands: Oklch[] = [];
  for (let k = 0; k < 6; k++) cands.push(holdValue(v, clamp(Math.max(c, 0.05) * (0.85 + 0.5 * rnd()), 0.04, 0.2), wrapHue(h + start + k * 60)));
  for (const dh of [-24, -10, 12, 26]) cands.push(holdValue(v, clamp(Math.max(c, 0.03) * (0.8 + 0.45 * rnd()), 0.02, 0.2), wrapHue(h + dh)));
  const turn = (x: Oklch) => (x[2] - h + 360) % 360;
  const out: Oklch[] = [];
  for (const x of cands.sort((a, b) => turn(a) - turn(b))) {
    if (out.length < count && deltaE(x, o.base.base) >= 3 && out.every((y) => deltaE(x, y) >= APART)) out.push(x);
  }
  return out.map((base) => ({ base, hex: toHex(base), steps: rampsFor([{ ...o.base, base }], o.light, o.like)[0].steps }));
}
