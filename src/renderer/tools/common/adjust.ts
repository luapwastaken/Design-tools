// Colour moves the checks' one-click fixes make, shared by the colour tools. All maths through shared/color.
// Fixes move VALUE (the grey a colour becomes, shared/color/value.ts), the one measure the value
// lock, the greyscale view and the checks all use: hue stays, chroma gives way where it must.
import { contrast, deltaE, inSrgb, simulateCvd, type Cvd, type Oklch } from '../../../shared/color/index.ts';
import { holdValue, valueOf } from '../../../shared/color/value.ts';
import type { ContrastPair } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';

/** `o`'s hue and chroma at value `v`; chroma only gives way at the sRGB edge, and never for a swatch already wider than sRGB (it stays wide) */
function withV(o: Oklch, v: number): Oklch {
  if (inSrgb(o)) return holdValue(v, o[1], o[2]);
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (valueOf([mid, o[1], o[2]]) < v) lo = mid;
    else hi = mid;
  }
  return [(lo + hi) / 2, o[1], o[2]];
}

/**
 * `list` spaced `gap` apart in value (0..1), keeping the order their value has now (returned in
 * `list`'s order). Of three placements (around where they sit, the lightest staying put, the darkest
 * staying put), the one furthest from the palette's other values (`others`), so a fix doesn't
 * make the next problem. `ok` rules placements out, such as one that breaks a passing contrast pair.
 * `held` (by index) colours never move: the rest make room round them, or `list` comes back as it
 * was when there is no room.
 */
export function spreadVs(list: Oklch[], gap: number, others: number[] = [], ok: (next: Oklch[]) => boolean = () => true, held: boolean[] = []): Oklch[] {
  if (held.some(Boolean)) return spreadHeld(list, gap, ok, held);
  const vs = list.map(valueOf);
  const order = list.map((_, i) => i).sort((i, j) => vs[i] - vs[j] || list[i][2] - list[j][2]);
  const span = (list.length - 1) * gap;
  const fit = (start: number) => Math.min(Math.max(start, 0), Math.max(0, 1 - span));
  const place = (start: number): Oklch[] => {
    const out = [...list];
    order.forEach((i, k) => (out[i] = withV(list[i], start + k * gap)));
    return out;
  };
  const clearance = (start: number) => Math.min(...others.flatMap((o) => order.map((_, k) => Math.abs(o - start - k * gap))));
  const around = order.reduce((sum, i, k) => sum + vs[i] - k * gap, 0) / list.length;
  const starts = [fit(around), fit(vs[order.at(-1)!] - span), fit(vs[order[0]])];
  const allowed = starts.filter((s) => ok(place(s)));
  return place((allowed.length ? allowed : starts).reduce((x, y) => (clearance(y) > clearance(x) + 1e-6 ? y : x)));
}

/** the free colours spaced round the held ones: each run between two held values (or the ends) packs in as near where it sits as it fits */
function spreadHeld(list: Oklch[], gap: number, ok: (next: Oklch[]) => boolean, held: boolean[]): Oklch[] {
  const vs = list.map(valueOf);
  const order = list.map((_, i) => i).sort((i, j) => vs[i] - vs[j] || list[i][2] - list[j][2]);
  const out = [...list];
  let run: number[] = [];
  let from = 0;
  let fits = true;
  const flush = (to: number) => {
    const pos = run.map((i) => vs[i]);
    pos.forEach((p, k) => (pos[k] = Math.max(p, k ? pos[k - 1] + gap : from)));
    if (run.length) pos[run.length - 1] = Math.min(pos[run.length - 1], to);
    for (let k = run.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - gap);
    if (run.length && pos[0] < from - 1e-9) fits = false;
    run.forEach((i, k) => (out[i] = withV(list[i], pos[k])));
    run = [];
  };
  for (const i of order) {
    if (!held[i]) run.push(i);
    else {
      flush(vs[i] - gap);
      from = vs[i] + gap;
    }
  }
  flush(1);
  return fits && ok(out) ? out : list;
}

/** Two swatches `gap` apart in value, the lighter one staying lighter. */
export const spreadV = (a: Oklch, b: Oklch, gap: number, others: number[] = [], ok?: (next: Oklch[]) => boolean, held?: boolean[]): [Oklch, Oklch] =>
  spreadVs([a, b], gap, others, ok, held) as [Oklch, Oklch];

/** Value collision: swatches that read as one grey, spaced just past the flag threshold (value 0..1). */
export const valueFix = (list: Oklch[], minGap: number, others: number[], ok?: (next: Oklch[]) => boolean, held?: boolean[]): Oklch[] =>
  spreadVs(list, Math.min(1 / Math.max(1, list.length - 1), minGap + 0.005), others, ok, held);

/**
 * Colour vision: the smallest value spread that parts the pair under this simulation, or null.
 * `ok` rules a spread out (one that breaks a contrast pair that passes); `held` colours never move.
 */
export function cvdFix(
  a: Oklch,
  b: Oklch,
  kind: Cvd,
  minE: number,
  others: number[],
  ok: (next: [Oklch, Oklch]) => boolean = () => true,
  held: [boolean, boolean] = [false, false],
): [Oklch, Oklch] | null {
  if (held[0] && held[1]) return null;
  for (let gap = Math.abs(valueOf(a) - valueOf(b)) + 0.01; gap <= 1; gap += 0.01) {
    const [x, y] = spreadV(a, b, gap, others, ok as (next: Oklch[]) => boolean, held);
    if (deltaE(simulateCvd(x, kind), simulateCvd(y, kind)) >= minE && ok([x, y])) return [x, y];
  }
  return null;
}

/** What the checks' one-click fixes may do: which swatches never move, which move first, and what a move must not break */
export type FixRules = {
  /** swatch ids a fix never moves */
  locked?: readonly string[];
  /** lower moves first (Highlight, Accent, Muted before Primary, Text); equal ranks move together */
  rank?(w: Swatch): number;
  /** contrast pairs: a fix that breaks one that passes now is not offered */
  contrast?: ContrastPair[];
};

/** a move breaks no contrast pair that passes now (`moved`: new colours by swatch id) */
export const holdsPairs =
  (pairs: ContrastPair[] = []) =>
  (moved: Map<string, Oklch>): boolean =>
    pairs.every((p) => p.ratio < p.target || contrast(moved.get(p.text.id) ?? p.text.oklch, moved.get(p.ground.id) ?? p.ground.oklch) >= p.target);

/**
 * The colours that part `a` and `b` under every simulation in `kinds`, by swatch id: a locked one
 * stays, the colour that moves first (`rules.rank`) moves alone where that reaches, and no passing
 * contrast pair breaks. `blocked` when both are locked; no changes when no spread parts them.
 */
export function partPair(a: Swatch, b: Swatch, kinds: Cvd[], minE: number, swatches: Swatch[], rules: FixRules = {}): { changes: Record<string, Oklch> | null; blocked: boolean } {
  const locked = (w: Swatch) => !!rules.locked?.includes(w.id);
  if (locked(a) && locked(b)) return { changes: null, blocked: true };
  const others = swatches.filter((w) => w.id !== a.id && w.id !== b.id).map((w) => valueOf(w.oklch));
  const holds = holdsPairs(rules.contrast);
  const [ra, rb] = [rules.rank?.(a) ?? 0, rules.rank?.(b) ?? 0];
  // the held side first (a locked one, then the one that moves later), and only then both free
  const tries: [boolean, boolean][] = locked(a) || locked(b) ? [[locked(a), locked(b)]] : ra !== rb ? [[ra > rb, rb > ra], [false, false]] : [[false, false]];
  for (const held of tries) {
    let [x, y] = [a.oklch, b.oklch];
    for (const k of kinds) [x, y] = cvdFix(x, y, k, minE, others, (n) => holds(new Map([[a.id, n[0]], [b.id, n[1]]])), held) ?? [x, y];
    if (x !== a.oklch || y !== b.oklch) return { changes: { [a.id]: x, [b.id]: y }, blocked: false };
  }
  return { changes: null, blocked: false };
}

/**
 * A run of swatches that read as one grey, spaced apart in value (valueFix): a locked one stays, the
 * colours that move first (`rules.rank`) make the room where that reaches, and no passing contrast
 * pair breaks. `blocked` when every one is locked; no changes when nothing can move.
 */
export function spreadCluster(cluster: Swatch[], minGap: number, others: number[], rules: FixRules = {}): { changes: Record<string, Oklch> | null; blocked: boolean } {
  const held = cluster.map((w) => !!rules.locked?.includes(w.id));
  if (held.every(Boolean)) return { changes: null, blocked: true };
  const holds = holdsPairs(rules.contrast);
  const ok = (next: Oklch[]) => holds(new Map(cluster.map((w, i) => [w.id, next[i]])));
  const ranks = cluster.map((w) => rules.rank?.(w) ?? 0);
  const top = Math.max(...ranks.filter((_, i) => !held[i]));
  const free = ranks.some((r, i) => !held[i] && r < top);
  const tries = free ? [held.map((h, i) => h || ranks[i] === top), held] : [held];
  for (const mask of tries) {
    const next = valueFix(cluster.map((w) => w.oklch), minGap, others, ok, mask);
    if (next.some((o, i) => o !== cluster[i].oklch)) return { changes: Object.fromEntries(cluster.map((w, i) => [w.id, next[i]])), blocked: false };
  }
  return { changes: null, blocked: false };
}
