// The pasteboard's geometry, pure so it is unit tested (test/logo-tool.test.ts): where each lockup's
// artboard sits, and where the logo sits on it. Every lockup is drawn at one size of wordmark (its
// cap height is CAP content px everywhere), so the artboards compare like with like; one that would
// overflow its artboard shrinks to fit.
import { layoutLockup, type Layout } from '../../../shared/logo/layout.ts';
import { available, shownLockups, twoParts, type Lockup, type LockupKind, type LogoDoc, type Rect } from './doc.ts';
import { corners } from './geometry.ts';

/** an artboard, in content px */
export const CELL = { w: 880, h: 500 };
export const GAP = 72;
/** the room above an artboard for its name */
export const LABEL = 60;
const ROW_GAP = 56;
/** the wordmark's cap height (or artwork height, with no cap found), content px */
export const CAP = 96;
/** how much of an artboard its logo with clearspace may fill */
const FILL = 0.9;

/**
 * artboards per row: one for one, two otherwise. Two columns keep the board near the stage's own
 * shape (about 3:2), so Fit fills the view instead of leaving bands above and below three across.
 */
export const columns = (n: number): number => (n <= 1 ? 1 : 2);

/** layout units are icon heights, so a lockup's size on screen follows its ratio: the icon alone and the wordmark alone borrow the main pair's */
export function unitRatio(d: LogoDoc, l: Lockup): number {
  if (l.kind !== 'icon') return l.ratio;
  const main = d.lockups.find((x) => x.on && twoParts(x.kind) && available(d, x.kind)) ?? d.lockups.find((x) => twoParts(x.kind));
  return main?.ratio ?? 2;
}

/** an icon handle held: the corner that stays put, in content px, and the size the lockup keeps while it is held */
export type Drag = { kind: LockupKind; k: number; anchor: { x: number; y: number }; corner: number };

export type Cell = {
  l: Lockup;
  /** the artboard's top left */
  x: number;
  y: number;
  lay: Layout;
  /** content px per layout unit */
  u: number;
  /** 1, or less when the logo shrank to fit its artboard */
  k: number;
  /** the logo with its clearspace: what the export draws */
  img: Rect;
};

export function place(d: LogoDoc, l: Lockup, at: { x: number; y: number }, drag: Drag | null = null): Cell {
  const lay = layoutLockup(d, l);
  const pad = d.clearspace;
  const u0 = CAP * unitRatio(d, l);
  const held = drag?.kind === l.kind ? drag : null;
  const fit = Math.min(1, (FILL * CELL.w) / ((lay.w + 2 * pad) * u0), (FILL * CELL.h) / ((lay.h + 2 * pad) * u0));
  const k = held?.k ?? fit;
  const u = u0 * k;
  const [w, h] = [(lay.w + 2 * pad) * u, (lay.h + 2 * pad) * u];
  let [x, y] = [at.x + (CELL.w - w) / 2, at.y + (CELL.h - h) / 2];
  // held by a corner: the opposite corner of the icon stays where it was while the lockup grows round it
  if (held && lay.icon) {
    const a = corners(lay.icon)[(held.corner + 2) % 4];
    [x, y] = [held.anchor.x - (a.x + pad) * u, held.anchor.y - (a.y + pad) * u];
  }
  return { l, x: at.x, y: at.y, lay, u, k, img: { x, y, w, h } };
}

export function boardLayout(d: LogoDoc, drag: Drag | null = null): { w: number; h: number; cells: Cell[] } {
  const list = shownLockups(d);
  const cols = columns(list.length);
  const rows = Math.max(1, Math.ceil(list.length / cols));
  return {
    w: cols * CELL.w + (cols - 1) * GAP,
    h: rows * (LABEL + CELL.h) + (rows - 1) * ROW_GAP,
    cells: list.map((l, i) => place(d, l, { x: (i % cols) * (CELL.w + GAP), y: Math.floor(i / cols) * (LABEL + CELL.h + ROW_GAP) + LABEL }, drag)),
  };
}
