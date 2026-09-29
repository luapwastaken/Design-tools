// The Logo tool's document (plan: Document), the limits every edit keeps, and the Library file.
import type { Oklch } from '../../../shared/color/index.ts';
import { usable } from '../../../shared/logo/layout.ts';
import { proposeLockups } from '../../../shared/logo/propose.ts';
import { previewSvg } from '../../../shared/logo/svg.ts';
import { ALIGNS, KINDS, needsIcon, needsWordmark, VERSIONS, type Lockup, type LockupKind, type LogoDoc, type Part, type Version } from '../../../shared/logo/types.ts';
import { parseSvg, serialize, setAttr } from '../../../shared/svg/xml.ts';
import type { LogoPayload } from '../../../shared/types.ts';

export type { Align, Lockup, LockupKind, LogoDoc, Part, Rect, Version } from '../../../shared/logo/types.ts';
export { ALIGNS, KIND_LABEL, KINDS, VERSION_LABEL, VERSIONS } from '../../../shared/logo/types.ts';

export type Role = 'icon' | 'wordmark';

export const LIMIT = {
  ratio: [0.25, 8],
  gap: [0, 4],
  clearspace: [0.25, 2],
  pngHeight: [16, 8192],
  dpi: [72, 1200],
} as const;

/** where each kind puts the icon, said plainly */
export const KIND_WHERE: Record<LockupKind, string> = {
  horizontal: 'Icon left',
  'horizontal-rev': 'Icon right',
  stacked: 'Icon above',
  compact: 'Icon above, the name as wide',
  icon: 'Icon alone',
  wordmark: 'Wordmark alone',
};

/** for file names: "Acme horizontal black.svg" */
export const KIND_FILE: Record<LockupKind, string> = {
  horizontal: 'horizontal',
  'horizontal-rev': 'horizontal reversed',
  stacked: 'stacked',
  compact: 'compact',
  icon: 'icon',
  wordmark: 'wordmark',
};

export const VERSION_NOTE: Record<Version, string> = {
  original: 'The artwork’s own colours',
  black: 'Every fill black, white ones cut out',
  white: 'Every fill white, white ones cut out',
  colour: 'Every fill the colour below, white ones cut out',
  knockout: 'White on a field of the colour',
};

const INK: Oklch = [0.48, 0.15, 262];

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** a lockup before any part exists: the proposal replaces it once one arrives */
const blank = (kind: LockupKind): Lockup => ({ kind, on: false, ratio: 2, gap: 0.5, align: 'center' });

export const emptyDoc = (): LogoDoc => ({
  icon: null,
  wordmark: null,
  lockups: KINDS.map(blank),
  versions: ['original', 'black', 'white'],
  colour: INK,
  clearspace: 0.5,
  exportPadding: 'clearspace',
  pngHeight: 512,
});

export const isEmpty = (d: LogoDoc): boolean => !d.icon && !d.wordmark;

/** the lockup's parts are there */
export const available = (d: Pick<LogoDoc, 'icon' | 'wordmark'>, kind: LockupKind): boolean =>
  (!needsIcon(kind) || usable(d.icon)) && (!needsWordmark(kind) || usable(d.wordmark));

/** the lockups the sheet and Export all draw: on, with their parts there, in the document's order */
export const shownLockups = (d: LogoDoc): Lockup[] => d.lockups.filter((l) => l.on && available(d, l.kind));

export const shownVersions = (d: LogoDoc): Version[] => VERSIONS.filter((v) => d.versions.includes(v));

export const twoParts = (kind: LockupKind): boolean => needsIcon(kind) && needsWordmark(kind);

export const lockupOf = (d: LogoDoc, kind: LockupKind): Lockup => d.lockups.find((l) => l.kind === kind) ?? blank(kind);

export const mapLockup = (d: LogoDoc, kind: LockupKind, fn: (l: Lockup) => Lockup): LogoDoc => ({ ...d, lockups: d.lockups.map((l) => (l.kind === kind ? fn(l) : l)) });

/** the lockups the parts suggest, `on` among them */
export const proposed = (d: Pick<LogoDoc, 'icon' | 'wordmark'>): Lockup[] => proposeLockups(d.icon, d.wordmark);

/**
 * A part in or out. The first time both parts are there (or one goes), the lockups are proposed
 * afresh from their shapes; replacing a part of a finished pair keeps every lockup's proportions.
 */
export function withPart(d: LogoDoc, role: Role, part: Part | null): LogoDoc {
  const next = { ...d, [role]: part };
  const kept = usable(d.icon) && usable(d.wordmark) && usable(next.icon) && usable(next.wordmark);
  return fix(kept ? next : { ...next, lockups: proposed(next) });
}

/** the rules no edit may break, applied after each one */
export function fix(d: LogoDoc): LogoDoc {
  const lockups = KINDS.map((kind) => {
    const l = d.lockups.find((x) => x.kind === kind) ?? blank(kind);
    return {
      kind,
      on: l.on === true,
      ratio: clamp(l.ratio, LIMIT.ratio),
      gap: clamp(l.gap, LIMIT.gap),
      align: ALIGNS[kind].includes(l.align) ? l.align : ALIGNS[kind].includes('cap') && d.wordmark?.type ? 'cap' : 'center',
    } satisfies Lockup;
  });
  // the document's order is the proposal's preference: the first one on is the logo's main lockup
  const order = d.lockups.map((l) => l.kind).filter((k, i, all) => KINDS.includes(k) && all.indexOf(k) === i);
  const sorted = [...order, ...KINDS.filter((k) => !order.includes(k))].map((k) => lockups.find((l) => l.kind === k)!);
  // the wordmark alone has no icon of its own to count clearspace and size in: it takes the main
  // pair's, or with no icon at all its cap height is the unit
  const main = sorted.find((l) => l.on && twoParts(l.kind)) ?? sorted.find((l) => twoParts(l.kind))!;
  const alone = sorted.find((l) => l.kind === 'wordmark')!;
  alone.ratio = usable(d.icon) ? main.ratio : 1;
  return {
    ...d,
    lockups: sorted,
    versions: VERSIONS.filter((v) => d.versions.includes(v)),
    clearspace: clamp(d.clearspace, LIMIT.clearspace),
    pngHeight: Math.round(clamp(d.pngHeight, LIMIT.pngHeight)),
  };
}

// -- the Library file --

const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"/>';

/** A raster part as markup other tools can take (Pattern's shape, Design's colours): its pixels in an SVG. */
function rasterMarkup(p: Part): string {
  const { w, h } = p.box;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><image width="${w}" height="${h}" href="${p.png}" xlink:href="${p.png}"/></svg>`;
}

const n3 = (v: number) => String(+v.toFixed(3));

/** an SVG part's own drawing framed to its artwork: other tools take the mark, not the artboard's padding round it */
function trimmedMarkup(svg: string, { x, y, w, h }: Part['box']): string {
  const root = parseSvg(svg);
  setAttr(root, 'viewBox', [x, y, w, h].map(n3).join(' '));
  setAttr(root, 'width', n3(w));
  setAttr(root, 'height', n3(h));
  return serialize(root);
}

const markupOf = (p: Part | null): string | null => (!p ? null : p.svg ? trimmedMarkup(p.svg, p.box) : p.png ? rasterMarkup(p) : null);
const metaOf = (p: Part | null) => p && { name: p.name, box: p.box, raster: !p.svg, ...(p.type ? { type: p.type } : {}), ...(p.silhouette ? { silhouette: p.silhouette } : {}) };

type Settings = Omit<LogoPayload, 'kind' | 'id' | 'version'>;

/** The file (plan: Document): each part's markup under `icon` and `wordmark`, as other tools read them, its measurements beside. */
// typed as Omit<LogoPayload, …> itself, not the alias: the tool contract checks it by Omit's variance
export const toPayload = (d: LogoDoc): Omit<LogoPayload, 'kind' | 'id' | 'version'> => ({
  icon: markupOf(d.icon),
  wordmark: markupOf(d.wordmark),
  parts: { icon: metaOf(d.icon), wordmark: metaOf(d.wordmark) },
  lockups: d.lockups,
  versions: d.versions,
  colour: d.colour,
  clearspace: d.clearspace,
  exportPadding: d.exportPadding,
  pngHeight: d.pngHeight,
  // the Library thumbnail and "as an image"
  preview: { svg: previewSvg(d) ?? EMPTY_SVG },
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const isOklch = (v: unknown): v is Oklch => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function rectOf(v: unknown): Part['box'] | null {
  if (!isObj(v)) return null;
  const r = { x: num(v.x, 0), y: num(v.y, 0), w: num(v.w, 0), h: num(v.h, 0) };
  return r.w > 0 && r.h > 0 ? r : null;
}

/** a part back from its markup and measurements; null when either is missing or odd */
function partOf(markup: unknown, meta: unknown, fallback: string): Part | null {
  if (typeof markup !== 'string' || !markup.includes('<svg') || !isObj(meta)) return null;
  const box = rectOf(meta.box);
  if (!box) return null;
  const t = isObj(meta.type) ? meta.type : null;
  const type = t && typeof t.capTop === 'number' && typeof t.baseline === 'number' ? { capTop: t.capTop, baseline: t.baseline, ...(typeof t.xTop === 'number' ? { xTop: t.xTop } : {}) } : undefined;
  const name = typeof meta.name === 'string' && meta.name ? meta.name : fallback;
  if (meta.raster !== true) return { svg: markup, png: null, name, box, ...(type ? { type } : {}) };
  const png = /\shref="(data:image\/[^"]+)"/.exec(markup)?.[1] ?? null;
  const silhouette = typeof meta.silhouette === 'string' && meta.silhouette.startsWith('data:image/') ? meta.silhouette : undefined;
  return png ? { svg: null, png, name, box, ...(type ? { type } : {}), ...(silhouette ? { silhouette } : {}) } : null;
}

function lockupsOf(raw: unknown): Lockup[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter(isObj).filter((l) => KINDS.includes(l.kind as LockupKind));
  if (!list.length) return null;
  return list.map((l) => ({
    kind: l.kind as LockupKind,
    on: l.on === true,
    ratio: num(l.ratio, 2),
    gap: num(l.gap, 0.5),
    align: (typeof l.align === 'string' ? l.align : 'center') as Lockup['align'],
  }));
}

/** A logo file as a document; anything missing or odd takes the default, so a hand-edited file still opens. */
export function fromPayload(p: Settings): LogoDoc {
  const def = emptyDoc();
  const parts = isObj(p.parts) ? p.parts : {};
  const icon = partOf(p.icon, parts.icon, 'Icon');
  const wordmark = partOf(p.wordmark, parts.wordmark, 'Wordmark');
  const listed = Array.isArray(p.versions) ? VERSIONS.filter((v) => (p.versions as unknown[]).includes(v)) : [];
  return fix({
    icon,
    wordmark,
    lockups: lockupsOf(p.lockups) ?? proposeLockups(icon, wordmark),
    versions: listed.length ? listed : def.versions,
    colour: isOklch(p.colour) ? p.colour : def.colour,
    clearspace: num(p.clearspace, def.clearspace),
    exportPadding: p.exportPadding === 'tight' ? 'tight' : 'clearspace',
    pngHeight: num(p.pngHeight, def.pngHeight),
  });
}

