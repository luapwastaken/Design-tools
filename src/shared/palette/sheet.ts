// The colour sheet: a specimen page of the palette as SVG (PNG is this, rasterised by the tool).
// The page colours here are the sheet's own, not app chrome, so they are plain hex.
import type { Swatch } from '../types.ts';
import { cmykEstimate, inSrgb, rgb255, toHex } from '../color/index.ts';

export type SheetOptions = { theme?: 'light' | 'dark'; columns?: number };

const PAGE = {
  light: { page: '#ffffff', ink: '#141414', dim: '#6e6e6e', edge: '#000000' },
  dark: { page: '#161616', ink: '#f0f0f0', dim: '#9a9a9a', edge: '#ffffff' },
};
const SANS = "Archivo, 'Archivo Variable', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'IBM Plex Mono', Consolas, ui-monospace, monospace";

const PAD = 48;
const GAP = 24;
const CELL = 216;
const CHIP = 144;
const HEAD = 96;
/** role, name, then four data rows */
const META = 128;

export function writeSheetSvg(name: string, swatches: Swatch[], opts: SheetOptions = {}): string {
  const t = PAGE[opts.theme ?? 'light'];
  const cols = Math.max(1, Math.min(opts.columns ?? 4, swatches.length || 1));
  const rows = Math.ceil(swatches.length / cols);
  const width = PAD * 2 + cols * CELL + (cols - 1) * GAP;
  const height = PAD * 2 + HEAD + rows * (CHIP + META) + Math.max(0, rows - 1) * GAP;
  const count = `${swatches.length} colour${swatches.length === 1 ? '' : 's'}`;
  const cells = swatches.map((s, i) => cell(s, PAD + (i % cols) * (CELL + GAP), PAD + HEAD + Math.floor(i / cols) * (CHIP + META + GAP), t));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${t.page}"/>`,
    `<text x="${PAD}" y="${PAD + 26}" font-family="${SANS}" font-size="28" font-weight="600" fill="${t.ink}">${xml(name.trim() || 'Palette')}</text>`,
    `<text x="${PAD}" y="${PAD + 52}" font-family="${MONO}" font-size="11" letter-spacing="1" fill="${t.dim}">${count.toUpperCase()}</text>`,
    ...cells,
    '</svg>',
    '',
  ].join('\n');
}

function cell(s: Swatch, x: number, y: number, t: (typeof PAGE)['light']): string {
  const hex = toHex(s.oklch);
  const [l, c, h] = s.oklch;
  const rows: [string, string, string?][] = [
    ['HEX', hex.toUpperCase(), inSrgb(s.oklch) ? '' : 'outside sRGB'],
    ['OKLCH', `${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)}`],
    ['RGB', rgb255(s.oklch).join(' ')],
    ['≈CMYK', cmykEstimate(s.oklch).join(' ')],
  ];
  const top = y + CHIP;
  return [
    `<g>`,
    `<rect x="${x}" y="${y}" width="${CELL}" height="${CHIP}" rx="3" fill="${hex}"/>`,
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CHIP - 1}" rx="2.5" fill="none" stroke="${t.edge}" stroke-opacity="0.1"/>`,
    `<text x="${x}" y="${top + 22}" font-family="${MONO}" font-size="10" letter-spacing="1" fill="${t.dim}">${xml((s.role ?? '').toUpperCase())}</text>`,
    `<text x="${x}" y="${top + 42}" font-family="${SANS}" font-size="16" font-weight="600" fill="${t.ink}">${xml(s.name.trim() || hex.toUpperCase())}</text>`,
    ...rows.map(
      ([k, v, note], i) =>
        `<text x="${x}" y="${top + 66 + i * 16}" font-family="${MONO}" font-size="11"><tspan fill="${t.dim}">${xml(k)}</tspan><tspan x="${x + 52}" fill="${t.ink}">${xml(v)}</tspan>${note ? `<tspan dx="8" fill="${t.dim}">${xml(note)}</tspan>` : ''}</text>`,
    ),
    `</g>`,
  ].join('\n');
}

const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
