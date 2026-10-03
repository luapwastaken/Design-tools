// Image > Halftone: an image as a real print halftone, dots of one or more inks on paper at a
// physical size, as an SVG for Illustrator, a screen PNG and separations that all match the view.
// Spec: docs/superpowers/specs/2026-09-29-halftone-tool.md; plan unit V.
import type { ToolDefinition } from '../../shell/tool.ts';
import { flipOriginal } from '../common/flip.ts';
import { fetchBlob } from '../common/take.ts';
import { pickImage, sourceOf, takeFiles, withPalette } from './actions.ts';
import { emptyDoc, type HalftoneDoc } from './doc.ts';
import { pngBlob, pngLimit } from './exports.ts';
import { placement } from './screening.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { getView, patchView } from './view-state.ts';
import { View } from './View.tsx';

const flip = flipOriginal(() => getView().show, (show) => patchView({ show }), 'original', 'result');

export const tool: ToolDefinition<HalftoneDoc> = {
  id: 'halftone',
  label: 'Halftone',
  group: 'image',
  icon: 'blur_on',
  shortcut: 6,
  docVersion: 1,
  createEmptyDoc: emptyDoc,
  isEmpty: (d) => !d.source,
  // the doc bar says the same with no image
  docName: (d) => d.source?.name ?? 'No image',

  accepts: {
    image: { mode: 'open', label: 'IMAGE' },
    pattern: { mode: 'open', label: 'IMAGE' },
    logo: { mode: 'open', label: 'IMAGE' },
    svg: { mode: 'open', label: 'IMAGE' },
    palette: { mode: 'apply', label: 'INKS' },
  },
  async receive(item, _use, current) {
    if (item.kind === 'palette') {
      return withPalette(current, item.ref.name, item.payload.swatches);
    }
    if (!('url' in item)) return current;
    // the shell draws patterns, logos and SVGs as PNGs ("as an image"); a Library image keeps its own file
    const blob = await fetchBlob(item.url, item.ref.name);
    return { ...current, source: await sourceOf(blob, item.ref.name, item.ref.kind === 'image' ? item.ref.ext.toLowerCase() : 'png') };
  },

  /** the screen PNG with the page at the image's own resolution (plan unit V) */
  async render(d) {
    const at = placement(d);
    if (!d.source || !at) throw new Error('There is no image to send yet.');
    let width = Math.max(16, Math.round((d.source.w * (d.size.w * d.size.dpi)) / 25.4 / at.w));
    const height = () => Math.round((width * d.size.h) / d.size.w);
    // a page far wider than the image's pixels would be past what a PNG holds: it shrinks to fit
    while (pngLimit(width, height()) && width > 16) width = Math.floor(width * 0.9);
    return { blob: await pngBlob(d, width), name: `${d.source.name}`, ext: 'png' };
  },

  async onFiles(files, _how, doc) {
    const left = await takeFiles(doc, files);
    return left.length === files.length ? false : left.length ? left : true;
  },

  shortcuts: (doc) => [
    { keys: 'Ctrl+O', label: 'Open an image', run: () => pickImage(doc) },
    { keys: '\\', label: 'Switch between the result and the original', run: flip },
  ],
  StatusSlot,
  View,
};
