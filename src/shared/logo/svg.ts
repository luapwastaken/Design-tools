// Lockup SVGs out, as real editable vectors. Each part's own markup goes in one group placed by one
// transform, so Illustrator shows the part as a group of its paths as drawn. Every file namespaces
// the parts again under ids of its own, so two exports pasted into one page or document can't
// restyle each other. Versions are real fills through shared/svg recolour, never filters; a raster
// part is the one place an <image> appears. In the one-colour versions near-white paper inside the
// artwork (a white smile on a blue disc) is cut out by a luminance mask, rather than painted over.
import { contrast, parseCss, toHex, type Oklch } from '../color/index.ts';
import { namespace, recolour, svgColours } from '../svg/index.ts';
import { getAttr, isEl, parseSvg, serialize, textOf, walk, type Attr, type El } from '../svg/xml.ts';
import { clearspaceRect, layoutLockup, type Layout } from './layout.ts';
import type { Lockup, LockupKind, LogoDoc, Part, Rect, Version } from './types.ts';

export { clearspaceRect };

export type SvgOptions = {
  padding: 'clearspace' | 'tight';
  /** px, the whole file's height, padding included; by default an icon height is UNIT_PX */
  height?: number;
  /** the file's <title>: what a viewer or Illustrator calls the drawing */
  title?: string;
};

/** px per icon height when no height is asked for, so the icon comes out alike in every lockup's file */
export const UNIT_PX = 100;

export const NOTHING = 'Add an icon or a wordmark first.';

// a part root's sizing and namespace: the file's root and the part's placement stand in for them
const ROOT_ONLY = /^(?:xmlns|version|baseProfile|x|y|width|height|viewBox|preserveAspectRatio|overflow|enable-background)$/;

export const n = (v: number): string => String(+v.toFixed(2));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** knockout brings its own field, so it always keeps the clearspace round the logo */
export const padOf = (doc: Pick<LogoDoc, 'clearspace'>, version: Version, padding: SvgOptions['padding']): number =>
  padding === 'clearspace' || version === 'knockout' ? doc.clearspace : 0;

/** near-white: paper showing through the artwork, which the one-colour versions cut out */
export const isPaper = ([l, c]: Oklch): boolean => l >= 0.9 && c <= 0.04;

/** the one colour a version paints the whole logo, or null to keep the artwork's own */
export function paintOf(doc: Pick<LogoDoc, 'colour'>, version: Version): string | null {
  if (version === 'original') return null;
  if (version === 'black') return '#000000';
  if (version === 'colour') return toHex(doc.colour);
  return '#ffffff';
}

/** FNV-1a of what a file draws: a short tag that keeps different logos' ids apart */
export function tag(...parts: (string | null | undefined)[]): string {
  const s = parts.map((p) => p ?? '').join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * What a part draws, less its root tag: the Library file frames the root to the artwork, and a
 * reopened logo must draw (and name) everything as it did.
 */
export function source(p: Part | null): string | null | undefined {
  if (!p?.svg) return p?.png;
  // quoted values may hold a >
  const head = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(p.svg);
  return head ? p.svg.slice(head.index + head[0].length) : p.svg;
}

/** a part's own markup as a group: its root's sizing goes, its styling and anything pointed at stays */
function asGroup(markup: string, head: Attr[], box: Rect): El {
  const root = parseSvg(markup);
  dropIdleClips(root, box);
  // Illustrator names every root "Layer_1"; the id only has to stay when something points at it
  const rootId = getAttr(root, 'id');
  const own = root.attrs.filter((a) => !ROOT_ONLY.test(a.name) && (a.name !== 'id' || markup.split(rootId!).length > 2));
  const nest = own.some((a) => a.name === 'id' || a.name === 'transform');
  return { name: 'g', attrs: nest ? head : [...head, ...own], children: nest ? [{ name: 'g', attrs: own, children: root.children }] : root.children };
}

const CLIP_SIDES = ['x', 'y', 'width', 'height'];
/** what a recolour leaves on a clip path, where paint means nothing */
const PAINT_ATTRS = ['fill', 'stroke'];

/**
 * Removes the clip paths that cut nothing: a lone rectangle well outside the artwork (Illustrator
 * clips to its artboard), with room to spare for the widest stroke. A clip that touches the artwork
 * stays, since it may be what trims a stroke or a shape.
 */
function dropIdleClips(root: El, box: Rect): void {
  const widths = [...serialize(root).matchAll(/stroke-width\s*[:=]\s*["']?([\d.]+)/g)].map((m) => Number(m[1]));
  const slack = 2 * (widths.length ? Math.max(...widths) : 1);
  const idle = new Set<string>();
  for (const { el } of walk(root)) {
    const id = getAttr(el, 'id');
    const inside = el.children.filter(isEl);
    if (el.name !== 'clipPath' || !id || el.attrs.some((a) => a.name !== 'id' && !PAINT_ATTRS.includes(a.name)) || inside.length !== 1 || inside[0].name !== 'rect') continue;
    if (inside[0].attrs.some((a) => !CLIP_SIDES.includes(a.name))) continue; // a transform, rounded corners, a clip of its own
    const [x, y, w, h] = CLIP_SIDES.map((k) => Number(getAttr(inside[0], k) ?? 0));
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 && x <= box.x - slack && y <= box.y - slack && x + w >= box.x + box.w + slack && y + h >= box.y + box.h + slack) idle.add(id);
  }
  // paint on a clip path does nothing, so the one-colour versions don't need to carry it
  for (const { el } of walk(root)) if (el.name === 'clipPath') el.attrs = el.attrs.filter((a) => !PAINT_ATTRS.includes(a.name));
  if (!idle.size) return;
  const url = (id: string) => `url\\(\\s*["']?#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*\\)`;
  const clips = new RegExp(`clip-path\\s*:\\s*(?:${[...idle].map(url).join('|')})\\s*;?`, 'g');
  const attr = new RegExp(`^\\s*(?:${[...idle].map(url).join('|')})\\s*$`);
  for (const { el } of walk(root)) {
    el.attrs = el.attrs.filter((a) => !(a.name === 'clip-path' && attr.test(a.value)));
    // the same clip written in an inline style
    const inline = el.attrs.find((a) => a.name === 'style');
    if (inline) inline.value = inline.value.replace(clips, '').trim();
    el.attrs = el.attrs.filter((a) => a.name !== 'style' || a.value);
    if (el.name === 'style') el.children = [el.children.some((c) => 'cdata' in c) ? { cdata: textOf(el).replace(clips, '') } : { text: textOf(el).replace(clips, '') }];
    el.children = el.children.filter((c) => !isEl(c) || c.name !== 'clipPath' || !idle.has(getAttr(c, 'id') ?? ''));
  }
}

/** which of the part's paints are paper, when it paints darker too (an all-white logo keeps its white) */
function paperIn(svg: string): ((paint: string) => boolean) | null {
  let colours: Oklch[];
  try {
    colours = svgColours(svg);
  } catch {
    return null;
  }
  if (!colours.some(isPaper) || colours.every(isPaper)) return null;
  return (paint) => {
    const o = parseCss(paint);
    return !!o && isPaper(o);
  };
}

/**
 * A part's artwork in its own units as one group with this id, which also prefixes everything
 * inside, painted in `paint` (null keeps its own colours). A raster part paints through its
 * silhouette, a mask on a rect of the paint.
 */
export function partGroup(part: Part, id: string, paint: string | null, transform?: string): string {
  const head: Attr[] = [{ name: 'id', value: id }, ...(transform ? [{ name: 'transform', value: transform }] : [])];
  const { x, y, w, h } = part.box;
  if (!part.svg) {
    const box = `x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"`;
    const image = (href: string) => `<image xlink:href="${esc(href)}" ${box} preserveAspectRatio="none"/>`;
    // the silhouette is white, so the luminance mask every reader applies shows its alpha
    const shape = part.silhouette
      ? `<mask id="${id}-alpha" maskUnits="userSpaceOnUse" ${box}>${image(part.silhouette)}</mask>`
      : `<mask id="${id}-alpha" mask-type="alpha" maskUnits="userSpaceOnUse" ${box}>${image(part.png ?? '')}</mask>`;
    const body = paint ? `${shape}<rect ${box} fill="${paint}" mask="url(#${id}-alpha)"/>` : image(part.png ?? '');
    return serialize({ name: 'g', attrs: head, children: [{ text: body }] });
  }
  if (!paint) return serialize(asGroup(namespace(part.svg, id), head, part.box));
  const ink = asGroup(namespace(recolour(part.svg, paint), id), head, part.box);
  const paper = paperIn(part.svg);
  if (!paper) return serialize(ink);
  // the same drawing, white where it inks and black where it is paper, masks the painted one
  const cut = asGroup(namespace(recolour(part.svg, (v) => (paper(v) ? '#000000' : '#ffffff')), `${id}-m`), [], part.box);
  const area = { x: x - 0.1 * w, y: y - 0.1 * h, width: 1.2 * w, height: 1.2 * h };
  const mask: El = {
    name: 'mask',
    attrs: [{ name: 'id', value: `${id}-paper` }, { name: 'maskUnits', value: 'userSpaceOnUse' }, ...Object.entries(area).map(([k, v]) => ({ name: k, value: n(v) }))],
    children: [cut],
  };
  return serialize({ ...ink, children: [mask, { name: 'g', attrs: [{ name: 'mask', value: `url(#${id}-paper)` }], children: ink.children }] });
}

/** whether an SVG part holds a picture, which its colour versions can't repaint */
export function holdsPicture(svg: string | null): boolean {
  if (!svg) return false;
  try {
    return [...walk(parseSvg(svg))].some(({ el }) => el.name === 'image');
  } catch {
    return false;
  }
}

/** where a drawing lands in a file: layout 0 0 at `ox oy` px, `u` px per icon height */
export type Place = { ox: number; oy: number; u: number };

/** the transform that draws a part's artwork box onto `r` (layout units) */
export function placement(part: Part, r: Rect, at: Place): string {
  const k = (r.h * at.u) / part.box.h;
  const x = at.ox + r.x * at.u - k * part.box.x;
  const y = at.oy + r.y * at.u - k * part.box.y;
  // a thousandth of a unit, not the files' two decimals: the artwork is scaled up from here, and a padded artboard's twin has to land on the tight one's pixels
  return `translate(${+x.toFixed(3)} ${+y.toFixed(3)}) scale(${+k.toPrecision(6)})`;
}

/** the parts a layout places, with their role */
export function placed(doc: Pick<LogoDoc, 'icon' | 'wordmark'>, lay: Layout): ['icon' | 'wordmark', Part, Rect][] {
  const out: ['icon' | 'wordmark', Part, Rect][] = [];
  if (doc.icon && lay.icon) out.push(['icon', doc.icon, lay.icon]);
  if (doc.wordmark && lay.wordmark) out.push(['wordmark', doc.wordmark, lay.wordmark]);
  return out;
}

export function svgFile(w: number, h: number, body: string, title?: string): string {
  // measured artwork is a hundredth off a whole size (a 100 px icon at 200.01): that is noise, and an odd artboard in Illustrator
  const snap = (v: number) => (Math.abs(v - Math.round(v)) < 0.02 ? Math.round(v) : v);
  const [sw, sh] = [n(snap(w)), n(snap(h))];
  const named = title?.trim() ? `<title>${esc(title.trim()).replace(/>/g, '&gt;')}</title>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${sw}px" height="${sh}px" viewBox="0 0 ${sw} ${sh}">${named}${body}</svg>\n`;
}

/** a lockup in a w × h px file on `ground` (transparent by default); knockout lays its field over the whole file */
export function drawn(doc: LogoDoc, kind: LockupKind, lay: Layout, version: Version, w: number, h: number, at: Place, ground?: string, title?: string): string {
  const paint = paintOf(doc, version);
  const prefix = `${kind}-${version}-${tag(source(doc.icon), source(doc.wordmark), paint)}`;
  const fill = version === 'knockout' ? toHex(doc.colour) : ground;
  const field = fill ? `<rect width="${n(w)}" height="${n(h)}" fill="${fill}"/>` : '';
  const parts = placed(doc, lay).map(([role, part, r]) => partGroup(part, `${prefix}-${role}`, paint, placement(part, r, at)));
  return svgFile(w, h, field + parts.join(''), title);
}

export function lockupSvg(doc: LogoDoc, lockup: Lockup, version: Version, opts: SvgOptions): string {
  const lay = layoutLockup(doc, lockup);
  if (!lay.w) throw new Error(NOTHING);
  const pad = padOf(doc, version, opts.padding);
  const h = lay.h + 2 * pad;
  const u = opts.height && opts.height > 0 ? opts.height / h : UNIT_PX;
  return drawn(doc, lockup.kind, lay, version, (lay.w + 2 * pad) * u, h * u, { ox: pad * u, oy: pad * u, u }, undefined, opts.title);
}

/**
 * The Library's picture: the first lockup that's on (else the first its parts allow, so a logo with
 * every lockup off still shows), in its own colours, trimmed, transparent; null when none draws.
 */
export function previewSvg(doc: LogoDoc): string | null {
  const draws = (l: Lockup) => layoutLockup(doc, l).w > 0;
  const first = doc.lockups.find((l) => l.on && draws(l)) ?? doc.lockups.find(draws);
  return first ? lockupSvg(doc, first, 'original', { padding: 'tight' }) : null;
}

/** the colours the parts' own artwork paints with, once each; raster parts can't say */
export function artColours(doc: Pick<LogoDoc, 'icon' | 'wordmark'>): Oklch[] {
  const seen = new Map<string, Oklch>();
  for (const p of [doc.icon, doc.wordmark]) {
    if (!p?.svg) continue;
    try {
      for (const c of svgColours(p.svg)) seen.set(toHex(c), seen.get(toHex(c)) ?? c);
    } catch {
      // unreadable markup paints nothing we can name
    }
  }
  return [...seen.values()];
}

export type Ground = 'light' | 'dark';

/** below this contrast with its ground a colour is as good as gone */
export const VANISH = 1.5;

/**
 * What a version sits on to be seen: knockout on its own field, anything else on `light` unless it
 * would all but vanish there and `dark` shows it better. The sheet's tiles and the opaque favicons
 * pick their ground by it, so a white logo is never shown white on white. How much of the logo each
 * of its own colours covers only a drawing tells: `own` is that verdict for the original version,
 * when the caller drew it; without it, dark only when every colour would vanish on light.
 */
export function groundFor(doc: LogoDoc, version: Version, light: string, dark: string, own?: Ground): string {
  if (version === 'knockout') return toHex(doc.colour);
  const paint = paintOf(doc, version);
  if (!paint && own) return own === 'dark' ? dark : light;
  const colours: (string | Oklch)[] = paint ? [paint] : artColours(doc);
  const vanish = (bg: string) => colours.every((c) => contrast(c, bg) < VANISH);
  return colours.length && vanish(light) && !vanish(dark) ? dark : light;
}
