// SVG for Illustrator: real units, the paper if it's included, then one group per visible ink named
// after it, each holding one compound path of that ink's dots, turned shapes written already
// turned. The dots come from screen.dots over the same cells the preview draws, so the file
// matches it dot for dot. Overprinted, transparent inks multiply and opaque ones cover (spec §6.3).
import { toHex } from '../color/index.ts';
import { axes, dots, pagePx } from './screen.ts';
import type { Cells, CellShape, DrawInk, Overlap, Paper, Screen, Size } from './types.ts';

export type SvgDoc = { size: Size; screen: Screen; inks: DrawInk[]; overlap: Overlap; paper: Paper };

/** 1in = 96 px, as SVG counts user units; width and height carry the real size */
const PX_PER_IN = 96;
/** path numbers to a hundredth of a px (under 3 microns): finer numbers are weight no press can print */
const Q = 100;
/** the paper, named so nobody sends it to press as an ink */
const PAPER_ID = 'Paper_preview_only';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Why this document has no SVG, or null. */
export function svgProblem(doc: Pick<SvgDoc, 'screen'>): string | null {
  return doc.screen.shape === 'stochastic'
    ? "A stochastic screen has no SVG: every print pixel is its own dot, millions of them on a page. Export the PNG or the separations instead."
    : null;
}

/** dots per piece of a path: no string past about 500 million characters can be made */
const PIECE = 1 << 20;

/** `cellsPerInk` lines up with `doc.inks`; a hidden ink's entry is never read. */
export const halftoneSvg = (doc: SvgDoc, cellsPerInk: readonly (Cells | null | undefined)[]): string => svgParts(doc, cellsPerInk).join('');

/** The file in pieces, to join or to write one after another: a page of dots can outgrow one string. */
export function svgParts(doc: SvgDoc, cellsPerInk: readonly (Cells | null | undefined)[]): string[] {
  const why = svgProblem(doc);
  if (why) throw new Error(why);
  const shape = doc.screen.shape as CellShape;
  const page = pagePx(doc.size);
  const scale = PX_PER_IN / doc.size.dpi;
  const [W, H] = [String(Math.round(page.w * scale * Q) / Q), String(Math.round(page.h * scale * Q) / Q)];
  const length = (mm: number) => (doc.size.unit === 'in' ? `${+(mm / 25.4).toFixed(4)}in` : `${+mm.toFixed(3)}mm`);
  const ids = new Set(['dt-page', PAPER_ID]);
  const overprint = doc.overlap === 'overprint';
  const groups = doc.inks.flatMap((ink, i) => {
    if (!ink.visible) return [];
    const c = cellsPerInk[i];
    if (!c) throw new Error(`No screen for the ink ${ink.name}.`);
    const blend = overprint && !ink.opaque ? ' style="mix-blend-mode:multiply"' : '';
    return [
      `<g id="${idFor(ink.name, ids)}" data-name="${esc(ink.name)}" clip-path="url(#dt-page)"${blend}><path fill="${toHex(ink.colour)}" d="`,
      ...pathData(c, dots(c, doc.screen).geom, shape, scale),
      `"/></g>\n`,
    ];
  });
  const opaque = doc.inks.filter((ink) => ink.visible && ink.opaque).map((ink) => ink.name);
  const how = overprint
    ? `The inks overprint through Multiply blending${opaque.length ? `; opaque inks (${opaque.join(', ')}) keep Normal blending and cover what is under them` : ''}. For press, select each ink and turn on Overprint Fill in Window > Attributes.`
    : doc.inks.filter((ink) => ink.visible).length > 1
      ? 'The inks knock out: each ink covers the ones listed before it.'
      : '';
  const paper = doc.paper.include ? ' The paper rectangle only shows the stock: delete it before print, or it prints as a tint.' : '';
  const note = `Halftone from Design Tools at ${+doc.screen.lpi.toFixed(2)} LPI, ${shape} dots. Each ink is one group holding one compound path.${how ? ` ${how}` : ''}${paper}`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${length(doc.size.w)}" height="${length(doc.size.h)}" viewBox="0 0 ${W} ${H}">\n` +
      `<!-- ${note.replace(/--/g, '-')} -->\n` +
      `<defs><clipPath id="dt-page"><rect width="${W}" height="${H}"/></clipPath></defs>\n` +
      (doc.paper.include ? `<rect id="${PAPER_ID}" data-name="Paper (preview only)" width="${W}" height="${H}" fill="${toHex(doc.paper.colour)}"/>\n` : ''),
    ...groups,
    `</svg>\n`,
  ];
}

/** a valid, unused XML id from the ink's name (Illustrator shows it as the group's name) */
function idFor(name: string, used: Set<string>): string {
  const base = name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^(?=[^A-Za-z_])/, 'Ink_') || 'Ink';
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
  used.add(id);
  return id;
}

/** a number of hundredths as path data writes it short: 0.5 as .5 */
function fmt(milli: number): string {
  const t = String(milli / Q);
  return t.startsWith('0.') ? t.slice(1) : t.startsWith('-0.') ? `-${t.slice(2)}` : t;
}

/** the next number of a list, as Illustrator writes them: no space before a minus */
const then = (t: string) => (t[0] === '-' ? t : ` ${t}`);

/**
 * One compound path's data, in hundredths of a px, in pieces of PIECE dots. Each dot starts with
 * a move relative to the last dot's start, taken between rounded points so a row of hundreds never
 * drifts, and ends closed.
 */
function pathData(cells: Cells, geom: Float32Array, shape: CellShape, scale: number): string[] {
  const { ux, uy, vx, vy } = axes(cells.angle);
  const k = scale * Q;
  const parts: string[] = [];
  let [px, py, first] = [0, 0, true];
  const move = (x: number, y: number) => {
    const [X, Y] = [Math.round(x * k), Math.round(y * k)];
    parts.push(first ? `M${fmt(X)}${then(fmt(Y))}` : `m${fmt(X - px)}${then(fmt(Y - py))}`);
    [px, py, first] = [X, Y, false];
  };
  /** local (along, across) steps as relative line-tos */
  const edges = (steps: number[]) => {
    let s = 'l';
    for (let i = 0; i < steps.length; i += 2) {
      const [du, dv] = [steps[i], steps[i + 1]];
      const x = fmt(Math.round((du * ux + dv * vx) * k));
      s += `${i ? then(x) : x}${then(fmt(Math.round((du * uy + dv * vy) * k)))}`;
    }
    parts.push(`${s}z`);
  };
  const tilt = then(String(+(-cells.angle).toFixed(4)));
  const pieces: string[] = [];
  for (let i = 0; i < cells.n; i++) {
    const [a, b] = [geom[2 * i], geom[2 * i + 1]];
    if (!(a > 0 && b > 0)) continue;
    if (parts.length >= PIECE) pieces.push(parts.splice(0).join(''));
    const [cx, cy] = [cells.x[i], cells.y[i]];
    switch (shape) {
      case 'round':
      case 'ellipse': {
        // two half arcs from one end of the major axis to the other and back. The radius is taken
        // from the rounded chord, a hundredth short of half of it: a renderer scales too small a
        // radius up to exactly half the chord (SVG's out-of-range radii), which centres both halves
        // on the dot. Rounded on its own, a radius past half the chord pulled the halves apart and
        // every other dot came out taller than its cell's coverage.
        move(cx - a * ux, cy - a * uy);
        const [dx, dy] = [Math.round(2 * a * ux * k), Math.round(2 * a * uy * k)];
        const r = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2) - 1);
        const rx = fmt(r);
        const radii = shape === 'round' ? `${rx} ${rx} 0` : `${rx}${then(fmt(Math.max(1, Math.round((r * b) / a))))}${tilt}`;
        parts.push(`a${radii} 1 0${then(fmt(dx))}${then(fmt(dy))} ${radii} 1 0${then(fmt(-dx))}${then(fmt(-dy))}z`);
        break;
      }
      case 'square':
      case 'line':
        move(cx + a * ux + b * vx, cy + a * uy + b * vy);
        edges([-2 * a, 0, 0, -2 * b, 2 * a, 0]);
        break;
      case 'diamond':
        move(cx + a * ux, cy + a * uy);
        edges([-a, a, -a, -a, a, -a]);
        break;
      case 'cross':
        // the plus outline from the tip of the right arm's lower edge, counter-clockwise in (u, v)
        move(cx + a * ux + b * vx, cy + a * uy + b * vy);
        edges([b - a, 0, 0, a - b, -2 * b, 0, 0, b - a, b - a, 0, 0, -2 * b, a - b, 0, 0, b - a, 2 * b, 0, 0, a - b, a - b, 0]);
        break;
    }
  }
  pieces.push(parts.join(''));
  return pieces;
}
