// The Illustration tool's document (plan: Document and view). Ramps are flattened into ordinary
// swatches, each with its ramp (`group`) and `step`, so every other tool reads a normal palette;
// `ramps` says how each one is built, in row order. Pure: no DOM, so it is unit tested.
import type { Oklch } from '../../../shared/color/index.ts';
import { MATERIALS, newRamp, regenerate } from '../../../shared/palette/ramp.ts';
import type { MaterialId, PalettePayload, RampSpec, Swatch } from '../../../shared/types.ts';
import { displayName, stepWord } from '../common/names.ts';

export type { RampSpec };
export { stepWord };
/** the scene light: what a ramp is born with when there is no ramp to copy (a preset chosen on an empty palette) */
export type SceneLight = { light: Oklch; shadow: Oklch };
export type IllustrationDoc = { swatches: Swatch[]; ramps: RampSpec[]; notes: string; scene?: SceneLight };

export const emptyDoc = (): IllustrationDoc => ({ swatches: [], ramps: [], notes: '' });

// ── reading ─────────────────────────────────────────────────────────────────────────────────────

const byStep = (a: Swatch, b: Swatch) => (a.step ?? 0) - (b.step ?? 0);

export const rampOf = (d: IllustrationDoc, id: string | undefined): RampSpec | null => d.ramps.find((r) => r.id === id) ?? null;

/** a ramp's steps, lightest first, as its row runs */
export const stepsOf = (d: IllustrationDoc, id: string): Swatch[] => d.swatches.filter((w) => w.group === id).sort(byStep);

export const baseOf = (d: IllustrationDoc, id: string): Swatch | null => d.swatches.find((w) => w.group === id && w.step === 0) ?? null;

/** swatches in no ramp: a flat palette opened here, or colours another tool added */
export function looseOf(d: IllustrationDoc): Swatch[] {
  const ids = new Set(d.ramps.map((r) => r.id));
  return d.swatches.filter((w) => w.group === undefined || !ids.has(w.group));
}

/** the base's name; with no base (another tool deleted it) the name its file kept; else the nearest colour name */
export const rampName = (d: IllustrationDoc, r: RampSpec): string => {
  const base = baseOf(d, r.id);
  return base ? displayName(base) : r.name?.trim() || displayName({ name: '', oklch: r.base });
};

/** the step's word within its ramp ("shadow"), or null for a loose swatch */
export function wordOf(d: IllustrationDoc, w: Swatch): string | null {
  if (w.step === undefined || !rampOf(d, w.group)) return null;
  const steps = stepsOf(d, w.group!).map((x) => x.step ?? 0);
  return stepWord(w.step, Math.min(...steps), Math.max(...steps));
}

/** a blank-named step reads "Skin shadow" (its ramp's name and its word); a base, the ramp's name */
export function nameOf(d: IllustrationDoc, w: Swatch): string {
  if (w.name.trim()) return w.name;
  const r = rampOf(d, w.group);
  if (!r || w.step === undefined) return displayName(w);
  const word = wordOf(d, w)!;
  return w.step === 0 ? rampName(d, r) : `${rampName(d, r)} ${word}`;
}

/** What export and the checks call each swatch: blank names filled in. */
export const named = (d: IllustrationDoc): Swatch[] => d.swatches.map((w) => (w.name.trim() ? w : { ...w, name: nameOf(d, w) }));

/** steps whose lightness doesn't fall from highlight to deep shadow (a hand edit, or a base moved past one) */
export function brokenSteps(steps: Swatch[]): string[] {
  return steps.filter((w, i) => i > 0 && w.oklch[0] >= steps[i - 1].oklch[0]).map((w) => w.id);
}

// ── writing: each returns the next document ────────────────────────────────────────────────────

/** row order: each ramp's steps lightest first, then the loose colours as they were */
function ordered(d: IllustrationDoc): IllustrationDoc {
  const loose = looseOf(d);
  return { ...d, swatches: [...d.ramps.flatMap((r) => stepsOf(d, r.id)), ...loose] };
}

/** the ramp's unedited steps built again from its spec (edited ones stay) */
export const regen = (d: IllustrationDoc, id: string): IllustrationDoc => ({ ...d, swatches: regenerate(d, id) });

const regenAll = (d: IllustrationDoc): IllustrationDoc => d.ramps.reduce((x, r) => regen(x, r.id), d);

const mapRamp = (d: IllustrationDoc, id: string, fn: (r: RampSpec) => RampSpec): IllustrationDoc => ({ ...d, ramps: d.ramps.map((r) => (r.id === id ? fn(r) : r)) });

/**
 * A Light setting of one ramp changed: its unedited steps follow. The hero quietens every other
 * ramp, so changing it regenerates them all; there is one hero at most.
 */
export function setSpec(d: IllustrationDoc, id: string, patch: Partial<Omit<RampSpec, 'id'>>): IllustrationDoc {
  if (patch.hero === undefined) return regen(mapRamp(d, id, (r) => ({ ...r, ...patch })), id);
  const next = { ...d, ramps: d.ramps.map((r) => (r.id === id ? { ...r, ...patch } : patch.hero ? { ...r, hero: false } : r)) };
  return regenAll(next);
}

/**
 * A colour picked for a swatch. The base is the ramp's base colour, so the ramp follows it; any
 * other step becomes hand-edited and stays put when the ramp regenerates. An edit drops the
 * imported values (Swatch.source), as in Design.
 */
export function recolour(d: IllustrationDoc, id: string, oklch: Oklch): IllustrationDoc {
  const w = d.swatches.find((x) => x.id === id);
  if (!w || w.oklch.every((v, i) => v === oklch[i])) return d;
  const { source: _, ...rest } = w;
  const r = rampOf(d, w.group);
  if (r && w.step === 0) {
    const { edited: _e, ...base } = rest;
    const next = { ...d, swatches: d.swatches.map((x) => (x.id === id ? { ...base, oklch } : x)) };
    return regen(mapRamp(next, r.id, (s) => ({ ...s, base: oklch })), r.id);
  }
  return { ...d, swatches: d.swatches.map((x) => (x.id === id ? { ...rest, oklch, ...(r && { edited: true }) } : x)) };
}

export const renameSwatch = (d: IllustrationDoc, id: string, name: string): IllustrationDoc => ({ ...d, swatches: d.swatches.map((w) => (w.id === id ? { ...w, name } : w)) });

/** a hand-edited step back to what its ramp makes */
export function revertStep(d: IllustrationDoc, id: string): IllustrationDoc {
  const w = d.swatches.find((x) => x.id === id);
  if (!w?.edited || !rampOf(d, w.group)) return d;
  const { edited: _, ...rest } = w;
  return regen({ ...d, swatches: d.swatches.map((x) => (x.id === id ? rest : x)) }, w.group!);
}

/** every hand-edited step of the ramp back to what it makes */
export function revertRamp(d: IllustrationDoc, id: string): IllustrationDoc {
  const swatches = d.swatches.map((w) => {
    if (w.group !== id || !w.edited) return w;
    const { edited: _, ...rest } = w;
    return rest;
  });
  return regen({ ...d, swatches }, id);
}

/** a ramp born like `like` (the last, or the one it follows); the first of a palette takes the scene light */
function spawn(d: IllustrationDoc, base: Oklch, like: RampSpec | null | undefined, material?: MaterialId): RampSpec {
  const spec = newRamp(base, undefined, like);
  if (!like && d.scene) Object.assign(spec, { light: [...d.scene.light], shadow: [...d.scene.shadow] });
  return material ? { ...spec, material } : spec;
}

const baseSwatch = (id: string, oklch: Oklch, name: string): Swatch => ({ id: crypto.randomUUID(), name, role: null, oklch, type: 'process', group: id, step: 0 });

/**
 * A new ramp from a base colour, after `after` (the end when null), lit as that ramp (or the last)
 * is, so a scene keeps one light; returns the base swatch's id too.
 */
export function addRamp(d: IllustrationDoc, oklch: Oklch, name = '', after: string | null = null, material?: MaterialId): { doc: IllustrationDoc; base: string } {
  const spec = spawn(d, oklch, rampOf(d, after ?? undefined) ?? d.ramps.at(-1), material);
  const at = d.ramps.findIndex((r) => r.id === after);
  const ramps = at < 0 ? [...d.ramps, spec] : [...d.ramps.slice(0, at + 1), spec, ...d.ramps.slice(at + 1)];
  const base = baseSwatch(spec.id, oklch, name);
  return { doc: ordered(regen({ ...d, ramps, swatches: [...d.swatches, base] }, spec.id)), base: base.id };
}

/** loose swatches become ramp bases, each keeping its id, name and role, lit as the last ramp is (plan: "Make ramps from these") */
export function makeRamps(d: IllustrationDoc, ids: string[]): IllustrationDoc {
  const taking = looseOf(d).filter((w) => ids.includes(w.id));
  const specs = taking.map((w) => spawn(d, w.oklch, d.ramps.at(-1)));
  const bases = new Map(taking.map((w, i) => [w.id, specs[i].id]));
  const swatches = d.swatches.map((w) => {
    const group = bases.get(w.id);
    if (!group) return w;
    const { edited: _, ...rest } = w;
    return { ...rest, group, step: 0 };
  });
  return ordered(specs.reduce((x, s) => regen(x, s.id), { ...d, ramps: [...d.ramps, ...specs], swatches }));
}

/** the ramp's light and shadow colours on every ramp: one light for the scene */
export function lightForAll(d: IllustrationDoc, id: string): IllustrationDoc {
  const r = rampOf(d, id);
  if (!r) return d;
  return regenAll({ ...d, ramps: d.ramps.map((x) => (x === r ? x : { ...x, light: [...r.light], shadow: [...r.shadow] })) });
}

/** one light for the scene: this light and shadow colour on every ramp (hand-edited steps stay), and on the next one born */
export const setScene = (d: IllustrationDoc, light: Oklch, shadow: Oklch): IllustrationDoc =>
  regenAll({ ...d, scene: { light: [...light], shadow: [...shadow] }, ramps: d.ramps.map((r) => ({ ...r, light: [...light], shadow: [...shadow] })) });

/** a colour in no ramp, gone */
export const removeLoose = (d: IllustrationDoc, id: string): IllustrationDoc => ({ ...d, swatches: d.swatches.filter((w) => w.id !== id || rampOf(d, w.group)) });

export function removeRamp(d: IllustrationDoc, id: string): IllustrationDoc {
  const next: IllustrationDoc = { ...d, ramps: d.ramps.filter((r) => r.id !== id), swatches: d.swatches.filter((w) => w.group !== id) };
  // the last ramp leaves its light behind for the next one
  const gone = rampOf(d, id);
  if (gone && !next.ramps.length) next.scene = { light: [...gone.light], shadow: [...gone.shadow] };
  // a hero gone lets the others speak up again
  return rampOf(d, id)?.hero ? regenAll(next) : next;
}

/** a copy of the ramp after it, edited steps and all (a copy of the hero isn't one, so it quietens); returns the copy's id */
export function duplicateRamp(d: IllustrationDoc, id: string): { doc: IllustrationDoc; id: string } {
  const r = rampOf(d, id);
  if (!r) return { doc: d, id };
  const { name: _, ...spec } = r;
  const copy: RampSpec = { ...spec, id: crypto.randomUUID(), hero: false };
  const steps = stepsOf(d, id).map((w) => ({ ...w, id: crypto.randomUUID(), group: copy.id, name: w.name && `${w.name} copy` }));
  const at = d.ramps.indexOf(r);
  const ramps = [...d.ramps.slice(0, at + 1), copy, ...d.ramps.slice(at + 1)];
  return { doc: ordered(regen({ ...d, ramps, swatches: [...d.swatches, ...steps] }, copy.id)), id: copy.id };
}

/** the ramp moved to sit before the row at `index` of the current order */
export function moveRamp(d: IllustrationDoc, id: string, index: number): IllustrationDoc {
  const r = rampOf(d, id);
  if (!r) return d;
  const before = d.ramps.slice(0, index).filter((x) => x !== r);
  const after = d.ramps.slice(index).filter((x) => x !== r);
  return ordered({ ...d, ramps: [...before, r, ...after] });
}

// ── from a file ─────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObjectOf = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const triple = (v: unknown): v is Oklch => Array.isArray(v) && v.length === 3 && v.every(num);

/** a ramp spec as a file (maybe hand-edited, maybe from an older build) holds it; null when unusable */
function specOf(raw: unknown): RampSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !triple(r.base)) return null;
  const def = newRamp(r.base, r.id);
  return {
    ...def,
    light: triple(r.light) ? r.light : def.light,
    shadow: triple(r.shadow) ? r.shadow : def.shadow,
    material: MATERIALS.some((m) => m.id === r.material) ? (r.material as MaterialId) : def.material,
    intensity: r.intensity === 'grounded' || r.intensity === 'extreme' || r.intensity === 'expressive' ? r.intensity : def.intensity,
    steps: num(r.steps) ? Math.min(9, Math.max(3, Math.round(r.steps))) : def.steps,
    hueShift: num(r.hueShift) ? Math.min(1, Math.max(-1, r.hueShift)) : def.hueShift,
    chromaCurve: num(r.chromaCurve) ? Math.min(1, Math.max(-1, r.chromaCurve)) : def.chromaCurve,
    hero: r.hero === true,
    ...(typeof r.name === 'string' && r.name.trim() && { name: r.name }),
  };
}

/** the file's body: each ramp notes its base's name, so the ramp keeps it if another tool deletes the base */
export function toPayload(d: IllustrationDoc): Pick<PalettePayload, 'swatches' | 'notes' | 'ramps' | 'scene'> {
  const ramps = d.ramps.map((r) => {
    const base = baseOf(d, r.id);
    if (!base) return r;
    const { name: _, ...rest } = r;
    return base.name.trim() ? { ...rest, name: base.name } : rest;
  });
  return { swatches: d.swatches, notes: d.notes, ramps, ...(d.scene && { scene: d.scene }) };
}

/**
 * The document a palette file makes. Another tool may have changed it: a swatch whose ramp is gone
 * (or a second one at the same step) is loose, a ramp with no swatches left is dropped, and a base
 * recoloured elsewhere is the ramp's base. Nothing regenerates here: opening changes no colour.
 */
export function fromPayload(p: Pick<PalettePayload, 'swatches' | 'notes' | 'ramps' | 'scene'>): IllustrationDoc {
  // a hand-edited file may list a ramp twice: the first one counts
  const specs = (Array.isArray(p.ramps) ? p.ramps : [])
    .map(specOf)
    .filter((r, i, all): r is RampSpec => !!r && all.findIndex((x) => x?.id === r.id) === i);
  const seen = new Set<string>();
  const swatches = p.swatches.map((raw): Swatch => {
    const w: Swatch = { ...raw, role: raw.role ?? null, type: raw.type ?? 'process' };
    const key = `${w.group}:${w.step}`;
    const fits = specs.some((r) => r.id === w.group) && num(w.step) && Number.isInteger(w.step) && !seen.has(key);
    if (fits) {
      seen.add(key);
      // the base is the ramp's own colour, never a hand-edited step (Design marks what it recolours)
      if (w.step !== 0 || !w.edited) return w;
      const { edited: _, ...base } = w;
      return base;
    }
    const { group: _g, step: _s, edited: _e, ...rest } = w;
    return rest;
  });
  let hero = false;
  const ramps = specs
    .filter((r) => swatches.some((w) => w.group === r.id))
    .map((r) => {
      const base = swatches.find((w) => w.group === r.id && w.step === 0);
      const one = r.hero && !hero;
      hero ||= one;
      return { ...r, base: base ? base.oklch : r.base, hero: one };
    });
  const scene = isObjectOf(p.scene) && triple(p.scene.light) && triple(p.scene.shadow) ? { scene: { light: [...p.scene.light] as Oklch, shadow: [...p.scene.shadow] as Oklch } } : {};
  return ordered({ swatches, ramps, notes: typeof p.notes === 'string' ? p.notes : '', ...scene });
}
