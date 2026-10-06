// Which colour plays which part in the In context website (plan unit X). Pure, so the picks are
// tested rather than eyeballed. Roles lead; a missing role falls back by lightness, and the two
// neutrals a palette rarely carries (a card surface just off the page, a muted ink that still
// reads) are derived from the ground pair. Text always follows the chosen ground: v1 pinned it, so
// its dark mockup put the palette's dark Text role on a dark page.
import { contrast, wcagGrade, type Oklch, type WcagGrade } from '../../../shared/color/index.ts';
import type { Role } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';

export type Mode = 'light' | 'dark';
/** A colour on the page: a palette swatch, or one made from them where the palette has no fit. */
export type Slot = { oklch: Oklch; name: string; swatchId: string | null };
export type Status = 'success' | 'warning' | 'error';
export type PairId = 'text' | 'muted' | 'link' | 'button' | 'mark' | 'cardTitle' | 'cardMeta' | Status | 'bars' | 'accent';
/** `what` is the smallest thing on the page drawn with this pair, which sets `need`. */
export type Pair = { fg: Slot; bg: Slot; ratio: number; grade: WcagGrade; need: number; ok: boolean; what: string };

export type Scene = {
  mode: Mode;
  page: Slot;
  surface: Slot;
  /** hairlines: the nav rule, card edges, list dividers */
  line: Slot;
  text: Slot;
  muted: Slot;
  primary: Slot;
  onPrimary: Slot;
  /** the Primary where it reads 4.5:1 as text on the page and card, else a darker (or lighter) shade of it: links are never the Accent */
  link: Slot;
  /** a lively second colour: a fill (marks, bars, outlines), never the colour of text */
  accent: Slot;
  /** a marker fill that the Text colour reads on */
  highlight: Slot;
  onHighlight: Slot;
  status: Record<Status, { fill: Slot; ink: Slot }>;
  pairs: Record<PairId, Pair>;
};

/** below this chroma a colour reads as a neutral */
const CHROMA = 0.04;
/** a status takes a palette colour only this close to its usual hue */
const STATUS_REACH = 40;
/** a made status colour keeps the primary's lightness within `l`: an amber only reads as amber when light */
const STATUS_HUE: Record<Status, { hue: number; name: string; l: [number, number] }> = {
  success: { hue: 145, name: 'green', l: [0.5, 0.66] },
  warning: { hue: 75, name: 'amber', l: [0.76, 0.86] },
  error: { hue: 25, name: 'red', l: [0.52, 0.66] },
};
const BRAND_ROLES: string[] = ['Primary', 'Accent', 'Highlight'] satisfies Role[];
const BLACK: Oklch = [0, 0, 0];
const WHITE: Oklch = [1, 0, 0];

const slot = (s: Swatch): Slot => ({ oklch: s.oklch, name: s.name, swatchId: s.id });
const made = (oklch: Oklch, name: string): Slot => ({ oklch, name, swatchId: null });
const hueGap = (a: number, b: number) => 180 - Math.abs((Math.abs(a - b) % 360) - 180);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ratio = (a: Slot, b: Slot) => contrast(a.oklch, b.oklch);
/** dark text reads better on it than light text does */
const isLight = (o: Oklch) => contrast(o, BLACK) >= contrast(o, WHITE);
const best = <T>(list: T[], score: (t: T) => number): T | undefined =>
  list.reduce<T | undefined>((top, t) => (top === undefined || score(t) > score(top) ? t : top), undefined);
/** whichever of the ground pair reads better on a fill: the palette does the work, never a stock white */
const onFill = (fill: Slot, page: Slot, text: Slot) => (ratio(page, fill) >= ratio(text, fill) ? page : text);

/** The website's colours on a light or a dark ground; null for an empty palette. */
export function scene(swatches: Swatch[], mode: Mode): Scene | null {
  if (!swatches.length) return null;
  const light = mode === 'light';
  const role = (r: Role, fits: (s: Swatch) => boolean = () => true) => swatches.find((s) => s.role === r && fits(s));
  // the page falls back to the lightest (or darkest) colour, leaving brand colours for the brand parts
  const unbranded = swatches.filter((s) => !s.role || !BRAND_ROLES.includes(s.role));
  const byL = [...(unbranded.length ? unbranded : swatches)].sort((a, b) => a.oklch[0] - b.oklch[0]);

  const pageSw = role('Background', (s) => isLight(s.oklch) === light) ?? (light ? byL.at(-1)! : byL[0]);
  const page = slot(pageSw);
  const lightPage = isLight(page.oklch);
  const [pl, pc, ph] = page.oklch;
  const others = swatches.filter((s) => s !== pageSw);
  // ink sits on the far side of the page from where the page leans
  const inkSide = (s: Swatch) => s !== pageSw && (lightPage ? s.oklch[0] < pl : s.oklch[0] > pl);

  const textSw = role('Text', inkSide) ?? best(others, (s) => contrast(s.oklch, page.oklch));
  const text = textSw ? slot(textSw) : made([lightPage ? 0.2 : 0.96, Math.min(pc, 0.02), ph], lightPage ? 'near-black (added)' : 'near-white (added)');

  const surfaceSw = role('Surface', (s) => s !== pageSw && isLight(s.oklch) === lightPage);
  // a card is the page lifted: lighter on a dark page; on a light one, whiter unless it's already white
  const lifted: Oklch = lightPage ? (pl < 0.95 ? [Math.min(1, pl + 0.035), pc * 0.7, ph] : [pl - 0.035, pc, ph]) : [pl + 0.05, pc, ph];
  const surface = surfaceSw ? slot(surfaceSw) : made(lifted, 'surface (derived)');

  const toward = text.oklch[0] > pl ? 1 : -1;
  const line = made([clamp(pl + toward * 0.12, 0, 1), pc * 0.5, ph], 'line (derived)');

  const mutedSw = role('Muted', inkSide);
  const muted = mutedSw ? slot(mutedSw) : made(deriveMuted(text.oklch, page, surface), 'muted (derived)');

  const used = new Set([pageSw, textSw, surfaceSw, mutedSw]);
  // a brand slot without its role takes a free colour, never one another brand role claims
  const pool = (own: string, also: Slot[]) =>
    swatches.filter((s) => !used.has(s) && !also.some((a) => a.swatchId === s.id) && !(s.role && s.role !== own && BRAND_ROLES.includes(s.role)));
  const chromatic = (list: Swatch[]) => list.filter((s) => s.oklch[1] >= CHROMA);
  const onPage = (s: Swatch) => contrast(s.oklch, page.oklch);

  const primarySw =
    role('Primary') ??
    best(chromatic(pool('Primary', [])), (s) => (onPage(s) >= 3 ? 10 : 0) + s.oklch[1]) ??
    best(pool('Primary', []), onPage) ??
    role('Accent') ??
    role('Highlight');
  // a palette of only ground colours gets the ink-on-page button real sites use
  const primary = primarySw ? slot(primarySw) : text;

  const accentSw =
    role('Accent') ??
    best(chromatic(pool('Accent', [primary])), (s) => (hueGap(s.oklch[2], primary.oklch[2]) > 20 ? 100 : 0) + (onPage(s) >= 3 ? 10 : 0) + onPage(s) / 21);
  const accent = accentSw ? slot(accentSw) : primary;

  const highlightSw = role('Highlight') ?? best(chromatic(pool('Highlight', [primary, accent])), (s) => s.oklch[1]);
  const picked = highlightSw ? slot(highlightSw) : accent;
  // a marker Text cannot read on (a deep one built for the other ground) is carried toward this page, so the preview still shows a marker
  const highlight = ratio(text, picked) >= 4.5 ? picked : made(deriveMarker(picked.oklch, text.oklch, page.oklch), 'highlight (derived)');

  const onPrimary = onFill(primary, page, text);
  const onHighlight = text;
  const link = ratio(primary, page) >= 4.5 && ratio(primary, surface) >= 4.5 ? primary : made(deriveLink(primary.oklch, text.oklch, page, surface), 'link (derived)');
  const status = statusColours(swatches, primary.oklch, page, text);

  const pair = (fg: Slot, bg: Slot, what: string, need = 4.5): Pair => {
    const r = ratio(fg, bg);
    return { fg, bg, ratio: r, grade: wcagGrade(r), need, ok: r >= need, what };
  };
  const pairs: Record<PairId, Pair> = {
    text: pair(text, page, 'Small text'),
    muted: pair(muted, page, 'Body text'),
    link: pair(link, page, 'A link'),
    button: pair(onPrimary, primary, 'A button label'),
    mark: pair(onHighlight, highlight, 'Text on a marker'),
    cardTitle: pair(text, surface, 'Small text'),
    cardMeta: pair(muted, surface, 'Small text'),
    success: pair(status.success.ink, status.success.fill, 'A pill label'),
    warning: pair(status.warning.ink, status.warning.fill, 'A pill label'),
    error: pair(status.error.ink, status.error.fill, 'A pill label'),
    bars: pair(accent, surface, 'A chart bar', 3),
    accent: pair(accent, page, 'An accent mark', 3),
  };

  return { mode, page, surface, line, text, muted, primary, onPrimary, link, accent, highlight, onHighlight, status, pairs };
}

/** The hover text of a failing pair, e.g. "Iron on Ground: 3.59:1, AA large · non-text. Body text needs 4.5:1." */
export const describe = (p: Pair): string =>
  `${p.fg.name} on ${p.bg.name}: ${p.ratio.toFixed(2)}:1, ${p.grade}. ${p.what} needs ${p.need}:1.`;

/**
 * The Primary walked toward the text colour (hue kept) until it only just clears 4.6:1 on the page and
 * the card: the link-safe shade of a brand colour that is too light, or too dark, to read as a link.
 */
function deriveLink(primary: Oklch, text: Oklch, page: Slot, surface: Slot): Oklch {
  const TARGET = 4.6;
  const at = (k: number): Oklch => [primary[0] + (text[0] - primary[0]) * k, primary[1] * (1 - k) + text[1] * k, primary[2]];
  const reads = (o: Oklch) => Math.min(contrast(o, page.oklch), contrast(o, surface.oklch)) >= TARGET;
  if (!reads(at(1))) return text;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (reads(at(mid))) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

/** the marker's lightness walked toward the page (hue kept, chroma easing) until the text reads on it at 4.6:1 */
function deriveMarker(marker: Oklch, text: Oklch, page: Oklch): Oklch {
  const at = (k: number): Oklch => [marker[0] + (page[0] - marker[0]) * k, marker[1] * (1 - 0.3 * k), marker[2]];
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(text, at(mid)) >= 4.6) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

/**
 * Text walked toward the page until it only just clears 4.5:1 on both page and card, found by
 * bisection since contrast isn't linear in L. Text that can't clear it is kept as it is.
 */
function deriveMuted(t: Oklch, page: Slot, surface: Slot): Oklch {
  const TARGET = 4.6;
  const at = (k: number): Oklch => [t[0] + (page.oklch[0] - t[0]) * k, t[1] + (page.oklch[1] - t[1]) * k, t[1] < 0.02 ? page.oklch[2] : t[2]];
  const reads = (o: Oklch) => Math.min(contrast(o, page.oklch), contrast(o, surface.oklch)) >= TARGET;
  if (!reads(t)) return t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (reads(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

/**
 * Success, warning and error from the palette's own colours nearest the usual hues, each colour
 * used once. A status with nothing near is made at its usual hue with about the primary's
 * lightness and chroma, so it still sits in the palette's tone.
 */
function statusColours(swatches: Swatch[], primary: Oklch, page: Slot, text: Slot): Scene['status'] {
  const kinds = Object.keys(STATUS_HUE) as Status[];
  const near = kinds
    .flatMap((k) => swatches.filter((s) => s.oklch[1] >= CHROMA).map((s) => ({ k, s, gap: hueGap(s.oklch[2], STATUS_HUE[k].hue) })))
    .filter((c) => c.gap <= STATUS_REACH)
    .sort((a, b) => a.gap - b.gap);
  const picked = new Map<Status, Swatch>();
  for (const c of near) if (!picked.has(c.k) && ![...picked.values()].includes(c.s)) picked.set(c.k, c.s);
  const fills = kinds.map((k) => {
    const sw = picked.get(k);
    const { hue, name, l } = STATUS_HUE[k];
    const fill = sw ? slot(sw) : made([clamp(primary[0], ...l), clamp(primary[1], 0.1, 0.15), hue], `${name} (added)`);
    return [k, { fill, ink: onFill(fill, page, text) }] as const;
  });
  return Object.fromEntries(fills) as Scene['status'];
}

/** the ground a palette is built for: its Background role's, else the light page unless it has no light colour */
export function ownMode(swatches: Swatch[]): Mode {
  const bg = swatches.find((s) => s.role === 'Background');
  if (bg) return isLight(bg.oklch) ? 'light' : 'dark';
  return swatches.some((s) => s.oklch[0] >= 0.85) || !swatches.length ? 'light' : 'dark';
}

/** the pairs the Check palette list reads from the preview of the palette's own ground: failures, and the ones no role pair already covers */
export const PREVIEW_ONLY: PairId[] = ['button', 'link', 'success', 'warning', 'error'];
