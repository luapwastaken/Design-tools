// The brand sheet: one page to drop into a guidelines document. Every lockup that's on in every
// version that's on, each lockup's clearspace, the small sizes at real pixels, and the parts' names
// and colours. Each part is defined once per version and placed with <use>, so a big wordmark isn't
// copied thirty times. The page colours are the sheet's own, not app chrome, so they are plain hex.
import { cmykEstimate, rgb255, toHex, type Oklch } from '../color/index.ts';
import { clearspaceRect, layoutLockup, spaceUnit } from './layout.ts';
import { artColours, groundFor, holdsPicture, n, NOTHING, paintOf, partGroup, placed, placement, source, svgFile, tag, type Ground, type Place } from './svg.ts';
import { KIND_LABEL, VERSION_LABEL, VERSIONS, type Lockup, type LogoDoc, type Part, type Version } from './types.ts';

/** `ground`: what the original version sits on, when the caller drew the logo to see (svg.ts groundFor) */
export type SheetOptions = { name?: string; ground?: Ground };

export const PAPER = { page: '#ffffff', ink: '#141414', dim: '#6e6e6e', light: '#f0f0f0', dark: '#1c1c1c', guide: '#8a8a8a', edge: '#000000' };
const SANS = "Archivo, 'Archivo Variable', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'IBM Plex Mono', Consolas, ui-monospace, monospace";

const PAD = 48;
const GAP = 16;
const TILE_W = 240;
const TILE_H = 150;
/** kept clear inside a tile, round the clearspace box */
const INSET = 12;
const CAPTION = 28;
const SMALL = [16, 24, 32, 48];
const SMALL_GAP = 32;
/** a small size takes at least its label's width, so narrow lockups' labels don't run together */
const SMALL_SLOT = 40;
const CHIP = 28;

const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** a part's name kept to its column */
const NAME_MAX = 38;
const clip = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1).trimEnd()}…` : s);
const rect = (x: number, y: number, w: number, h: number, fill: string, more = '') =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${more}/>`;
const label = (x: number, y: number, s: string, fill = PAPER.dim, anchor = 'start') =>
  `<text x="${n(x)}" y="${n(y)}" font-family="${MONO}" font-size="10" letter-spacing="1" text-anchor="${anchor}" fill="${fill}">${xml(s.toUpperCase())}</text>`;

export function brandSheetSvg(doc: LogoDoc, opts: SheetOptions = {}): string {
  const lockups = doc.lockups.filter((l) => l.on && layoutLockup(doc, l).w > 0);
  if (!lockups.length) throw new Error(NOTHING);
  const versions = VERSIONS.filter((v) => doc.versions.includes(v));
  const cols = Math.max(3, versions.length);
  const smallRow = (l: Lockup) => {
    const { w, h } = layoutLockup(doc, l);
    return SMALL.reduce((t, px) => t + Math.max((w / h) * px, SMALL_SLOT) + SMALL_GAP, 0);
  };
  const width = Math.max(PAD * 2 + cols * TILE_W + (cols - 1) * GAP, ...lockups.map((l) => PAD * 2 + GAP + smallRow(l)));
  const inner = width - 2 * PAD;

  const id = `sheet-${tag(source(doc.icon), source(doc.wordmark), toHex(doc.colour))}`;
  const defs = new Map<string, string>();
  const art = (l: Lockup, v: Version, at: Place) =>
    placed(doc, layoutLockup(doc, l)).map(([role, part, r]) => {
      const key = `${id}-${v}-${role}`;
      if (!defs.has(key)) defs.set(key, partGroup(part, key, paintOf(doc, v)));
      return `<use xlink:href="#${key}" transform="${placement(part, r, at)}"/>`;
    }).join('');
  const ground = (v: Version) => groundFor(doc, v, PAPER.light, PAPER.dark, opts.ground);
  /** a tile holding the lockup with its clearspace, fitted and centred */
  const tile = (l: Lockup, v: Version, x: number, y: number, caption: string, extra?: (logo: { x: number; y: number; w: number; h: number }, u: number) => string) => {
    const lay = layoutLockup(doc, l);
    const cs = clearspaceRect(doc, l);
    const u = Math.min((TILE_W - 2 * INSET) / cs.w, (TILE_H - 2 * INSET) / cs.h);
    const logo = { x: x + (TILE_W - lay.w * u) / 2, y: y + (TILE_H - lay.h * u) / 2, w: lay.w * u, h: lay.h * u };
    return rect(x, y, TILE_W, TILE_H, ground(v)) + (extra?.(logo, u) ?? '') + art(l, v, { ox: logo.x, oy: logo.y, u }) + label(x, y + TILE_H + 18, caption);
  };
  const grid = (count: number) => Math.ceil(count / cols) * (TILE_H + CAPTION + GAP);
  const cell = (i: number) => PAD + (i % cols) * (TILE_W + GAP);
  const row = (i: number) => Math.floor(i / cols) * (TILE_H + CAPTION + GAP);

  const out: string[] = [];
  let y = PAD;
  const section = (title: string) => {
    out.push(label(PAD, y + 10, title, PAPER.ink), rect(PAD, y + 20, inner, 1, PAPER.edge, ' fill-opacity="0.12"'));
    y += 40;
  };

  const cs = `${+doc.clearspace.toFixed(2)}× ${spaceUnit(doc)}`;
  out.push(
    `<text x="${PAD}" y="${PAD + 26}" font-family="${SANS}" font-size="28" font-weight="600" fill="${PAPER.ink}">${xml(opts.name?.trim() || 'Logo')}</text>`,
    label(PAD, PAD + 52, `${lockups.length} lockup${lockups.length === 1 ? '' : 's'} · ${versions.length} version${versions.length === 1 ? '' : 's'} · clearspace ${cs}`),
  );
  y += 88;

  if (versions.length) {
    section('Lockups');
    lockups.forEach((l, r) => versions.forEach((v, i) => out.push(tile(l, v, cell(i), y + r * (TILE_H + CAPTION + GAP), `${KIND_LABEL[l.kind]} · ${VERSION_LABEL[v]}`))));
    y += lockups.length * (TILE_H + CAPTION + GAP);
  }

  section(`Clearspace · ${cs}`);
  lockups.forEach((l, i) =>
    out.push(tile(l, 'original', cell(i), y + row(i), KIND_LABEL[l.kind], (b, u) => {
      const c = doc.clearspace * u;
      const [ox, oy, ow, oh] = [b.x - c, b.y - c, b.w + 2 * c, b.h + 2 * c];
      const band = `M${n(ox)} ${n(oy)}h${n(ow)}v${n(oh)}h${n(-ow)}z M${n(b.x)} ${n(b.y)}h${n(b.w)}v${n(b.h)}h${n(-b.w)}z`;
      return `<path d="${band}" fill="${PAPER.guide}" fill-opacity="0.18" fill-rule="evenodd"/>` +
        rect(ox, oy, ow, oh, 'none', ` stroke="${PAPER.guide}" stroke-width="1" stroke-dasharray="4 3"`);
    })),
  );
  y += grid(lockups.length);

  section('Small sizes · px at 1:1');
  for (const l of lockups) {
    const lay = layoutLockup(doc, l);
    out.push(rect(PAD, y, inner, 72, ground('original')));
    let x = PAD + GAP;
    for (const px of SMALL) {
      const u = px / lay.h;
      // whole pixels, as the size would really be placed
      out.push(art(l, 'original', { ox: Math.round(x), oy: y + 12 + 48 - px, u }), label(Math.round(x), y + 72 + 16, `${px} px`));
      x += Math.max(lay.w * u, SMALL_SLOT) + SMALL_GAP;
    }
    out.push(label(PAD + inner, y + 72 + 16, KIND_LABEL[l.kind], PAPER.dim, 'end'));
    y += 72 + CAPTION + GAP;
  }

  section('Parts and colours');
  const part = (role: string, p: Part | null) => {
    if (!p) return;
    out.push(label(PAD, y + 12, role), `<text x="${PAD + 96}" y="${y + 12}" font-family="${SANS}" font-size="14" fill="${PAPER.ink}">${xml(clip(p.name || 'Untitled'))}</text>`, label(PAD + 96 + 320, y + 12, !p.svg ? 'PNG' : holdsPicture(p.svg) ? 'SVG with a picture' : 'SVG, editable'));
    y += 24;
  };
  part('Icon', doc.icon);
  part('Wordmark', doc.wordmark);
  y += 12;
  if (versions.includes('colour') || versions.includes('knockout')) {
    const c = doc.colour;
    out.push(chip(PAD, y, c), label(PAD + CHIP + 12, y + 11, 'One colour'), `<text x="${PAD + CHIP + 12}" y="${y + 26}" font-family="${MONO}" font-size="11" fill="${PAPER.ink}">${xml(values(c))}</text>`);
    y += CHIP + GAP;
  }
  const own = artColours(doc);
  if (own.length) {
    out.push(label(PAD, y + 10, 'Original colours'));
    y += 20;
    const per = Math.max(1, Math.floor((inner + GAP) / (88 + GAP)));
    own.forEach((c, i) => {
      const x = PAD + (i % per) * (88 + GAP);
      const cy = y + Math.floor(i / per) * (CHIP + 30);
      out.push(chip(x, cy, c), label(x, cy + CHIP + 16, toHex(c), PAPER.ink));
    });
    y += Math.ceil(own.length / per) * (CHIP + 30);
  }

  const height = y + PAD;
  return svgFile(width, height, `<defs>${[...defs.values()].join('')}</defs>${rect(0, 0, width, height, PAPER.page)}${out.join('')}`);
}

function chip(x: number, y: number, c: Oklch): string {
  return rect(x, y, CHIP, CHIP, toHex(c)) + rect(x + 0.5, y + 0.5, CHIP - 1, CHIP - 1, 'none', ` stroke="${PAPER.edge}" stroke-opacity="0.1"`);
}

function values(c: Oklch): string {
  const [l, ch, h] = c;
  return `${toHex(c).toUpperCase()} · OKLCH ${l.toFixed(3)} ${ch.toFixed(3)} ${h.toFixed(1)} · RGB ${rgb255(c).join(' ')} · ≈CMYK ${cmykEstimate(c).join(' ')}`;
}
