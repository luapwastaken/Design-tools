// Settings builders and the checks every value from outside goes through (the document, share
// codes, presets), plus the two clocks moving effects keep. Pure, so it is unit tested.
import type { Oklch } from '../../../../shared/color/index.ts';
import type { ChoiceParam, ColourParam, NumberParam, Param, ParamValue, ToggleParam } from './types.ts';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

export function num(key: string, label: string, min: number, max: number, step: number, def: number, unit?: string, origin?: number): NumberParam {
  const places = decimals(step);
  return {
    kind: 'number', key, label, min, max, step, def, unit, origin,
    fit: (v) => {
      if (!finite(v)) return def;
      const snapped = min + Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step;
      return Math.min(max, +snapped.toFixed(places));
    },
  };
}

export const toggle = (key: string, label: string, def: boolean): ToggleParam => ({ kind: 'toggle', key, label, def, fit: (v) => (typeof v === 'boolean' ? v : def) });

export const choice = (key: string, label: string, options: readonly string[], def = 0): ChoiceParam => ({
  kind: 'choice', key, label, options, def,
  fit: (v) => (finite(v) ? Math.min(options.length - 1, Math.max(0, Math.round(v))) : def),
});

const isTriple = (v: unknown): v is Oklch => Array.isArray(v) && v.length === 3 && v.every(finite);

export const colour = (key: string, label: string, def: Oklch, tone?: number): ColourParam => ({
  kind: 'colour', key, label, def, tone,
  fit: (v) => (isTriple(v) ? [Math.min(1, Math.max(0, v[0])), Math.max(0, v[1]), ((v[2] % 360) + 360) % 360] : [...def]),
});

/** true when `v` is the kind of value `p` holds (fit then puts it in range) */
export function isValue(p: Param, v: unknown): v is ParamValue {
  if (p.kind === 'toggle') return typeof v === 'boolean';
  if (p.kind === 'colour') return isTriple(v);
  return finite(v);
}

export const defaultsFor = (params: readonly Param[]): Record<string, ParamValue> =>
  Object.fromEntries(params.map((p) => [p.key, Array.isArray(p.def) ? [...p.def] : p.def]));

/** every setting of `params`, from `given` where it holds a value of the right kind, in range */
export function valuesFor(params: readonly Param[], given: Readonly<Record<string, unknown>>): Record<string, ParamValue> {
  return Object.fromEntries(params.map((p) => [p.key, isValue(p, given[p.key]) ? p.fit(given[p.key] as ParamValue) : p.fit(p.def)]));
}

// ── the loop's clocks: both repeat exactly at t = 1, so a loop's frame N is its frame 0 ──

const wrap = (t: number) => (Number.isFinite(t) ? t - Math.floor(t) : 0);

/** which of `n` patterns shows at loop phase `t` (grain boil, glitch changes); 0 for n = 0 */
export const tick = (t: number, n: number): number => (n > 0 ? Math.floor(wrap(t) * n) % n : 0);

/**
 * Whole times a clock runs in a loop of `seconds`, for `rate` times a second. Always whole, so the loop
 * comes round exactly, and never none while the rate is above 0. The settings' own maximum is what keeps
 * it slow (at most 2 a second, and the shortest loop, 0.5 s, then holds 1).
 */
export const perLoop = (rate: number, seconds: number): number => (rate > 0 ? Math.max(1, Math.round(rate * seconds)) : 0);

/** an angle that turns `cycles` whole times over the loop, radians */
export const turn = (t: number, cycles: number): number => 2 * Math.PI * cycles * wrap(t);
