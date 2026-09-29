// Neutral synthetic logo parts for the logo tests (never real brand artwork: the repo is public).
import { namespace } from '../src/shared/svg/index.ts';
import type { Lockup, LogoDoc, Part } from '../src/shared/logo/types.ts';

const svg = (viewBox: string, body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs} viewBox="${viewBox}">${body}</svg>`;

/** a circle and a square, drawn tight: artwork 10..90 in a 100 box */
export const ICON_SVG = svg('0 0 100 100', '<circle cx="50" cy="50" r="40" fill="#e4572e"/><rect x="30" y="30" width="40" height="40" fill="#29335c"/>');
export const ICON_BOX = { x: 10, y: 10, w: 80, h: 80 };

/**
 * The same icon as Illustrator exports it: a padded artboard (the art moved by 110 60 in a 300 × 200
 * box), class rules in a <style>, a root id every Illustrator file shares.
 */
export const PADDED_SVG = svg(
  '0 0 300 200',
  '<defs><style>.cls-1{fill:#e4572e;}.cls-2{fill:#29335c;}</style></defs><circle class="cls-1" cx="160" cy="110" r="40"/><rect class="cls-2" x="140" y="90" width="40" height="40"/>',
  ' id="Layer_1" data-name="Layer 1"',
);
export const PADDED_BOX = { x: 120, y: 70, w: 80, h: 80 };
export const PADDED_SHIFT = { x: 110, y: 60 };

/** "HIT" as paths, caps only: cap top 0, baseline 70, nothing below */
const HIT = 'M0 0h14v70H0z M36 0h14v70H36z M14 28h22v14H14z M64 0h14v70H64z M92 0h50v14h-18v56h-14V14H92z';
export const WORD_SVG = svg('0 0 142 70', `<path d="${HIT}" fill="#29335c"/>`);
export const WORD_BOX = { x: 0, y: 0, w: 142, h: 70 };

/** "HIp": the same caps with a descender reaching 20 below the baseline */
export const DESC_SVG = svg('0 0 170 90', `<path d="${HIT} M150 30h14v60h-14z" fill="#29335c"/>`);
export const DESC_BOX = { x: 0, y: 0, w: 170, h: 90 };
export const TYPE = { capTop: 0, baseline: 70 };

/** a 4 × 2 px PNG as the intake keeps one: trimmed, box = its pixels */
export const PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGPQNI75j4wZ0AQYAN2vDLpOn6NOAAAAAElFTkSuQmCC';

export const part = (name: string, markup: string, box: Part['box'], more: Partial<Part> = {}): Part => ({
  svg: namespace(markup, name),
  png: null,
  name,
  box,
  ...more,
});

export const icon = () => part('icon', ICON_SVG, ICON_BOX);
export const padded = () => part('icon', PADDED_SVG, PADDED_BOX);
export const word = () => part('wordmark', WORD_SVG, WORD_BOX, { type: TYPE });
export const desc = () => part('wordmark', DESC_SVG, DESC_BOX, { type: TYPE });
export const pngPart = (): Part => ({ svg: null, png: PNG_URL, name: 'raster', box: { x: 0, y: 0, w: 4, h: 2 } });

export const lockup = (kind: Lockup['kind'], more: Partial<Lockup> = {}): Lockup => ({ kind, on: true, ratio: 2, gap: 0.5, align: 'center', ...more });

export const doc = (more: Partial<LogoDoc> = {}): LogoDoc => ({
  icon: icon(),
  wordmark: word(),
  lockups: [lockup('horizontal', { align: 'cap' }), lockup('stacked', { gap: 0.3, ratio: 3 }), lockup('icon'), lockup('wordmark')],
  versions: ['original', 'black', 'white', 'colour', 'knockout'],
  colour: [0.55, 0.2, 30],
  clearspace: 0.5,
  exportPadding: 'clearspace',
  pngHeight: 512,
  ...more,
});
