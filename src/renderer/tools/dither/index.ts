// Image > Dither: an image reduced to a small palette with a dither pattern at a chosen pixel size,
// pixel-exact in every file, for still and animated input.
// Spec: docs/superpowers/specs/2026-09-29-dither-tool.md; plan unit V.
import type { ToolDefinition } from '../../shell/tool.ts';
import { toast } from '../../ui/index.ts';
import { flipOriginal } from '../common/flip.ts';
import { fetchBlob } from '../common/take.ts';
import { pickImage, sourceOf, takeFiles, withPalette } from './actions.ts';
import { isAnimated, type DitherDoc } from './doc.ts';
import { sendBlob } from './exports.ts';
import { emptyDoc } from './looks.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { stepFrame } from './Transport.tsx';
import { getView, patchView, playhead } from './view-state.ts';
import { View } from './View.tsx';

const flip = flipOriginal(() => getView().show, (show) => patchView({ show }), 'original', 'result');

export const tool: ToolDefinition<DitherDoc> = {
  id: 'dither',
  label: 'Dither',
  group: 'image',
  icon: 'grain',
  shortcut: 5,
  docVersion: 1,
  createEmptyDoc: emptyDoc,
  isEmpty: (d) => !d.source,
  opaque: true,
  // the doc bar says the same with no image
  docName: (d) => d.source?.name ?? 'No image',

  accepts: {
    image: { mode: 'open', label: 'IMAGE' },
    pattern: { mode: 'open', label: 'IMAGE' },
    logo: { mode: 'open', label: 'IMAGE' },
    svg: { mode: 'open', label: 'IMAGE' },
    palette: { mode: 'apply', label: 'PALETTE' },
  },
  async receive(item, _use, current) {
    if (item.kind === 'palette') return withPalette(current, item.ref.name, item.payload.swatches, item.ref.id);
    if (!('url' in item)) return current;
    // the shell draws patterns, logos and SVGs as PNGs ("as an image"); a Library image keeps its own file
    const blob = await fetchBlob(item.url, item.ref.name);
    return { ...current, source: await sourceOf(blob, item.ref.name, item.ref.kind === 'image' ? item.ref.ext.toLowerCase() : 'png') };
  },

  /** the frame on screen as a PNG, each block the pixel size (plan: Send to renders the 1× PNG scaled by the pixel size), as the exports do */
  async render(d) {
    if (!d.source) throw new Error('There is no image to send yet.');
    const { blob, scale } = await sendBlob(d, Math.min(playhead.get().frame, d.source.frames - 1));
    if (scale < d.pixel) toast.show({ icon: 'info', message: `Sent with ${scale} px blocks: at ${d.pixel} px the image is more than a PNG here can hold.` });
    return { blob, name: d.source.name, ext: 'png' };
  },

  async onFiles(files, _how, doc) {
    const left = await takeFiles(doc, files);
    return left.length === files.length ? false : left.length ? left : true;
  },

  shortcuts: (doc) => [
    { keys: 'Ctrl+O', label: 'Open an image', run: () => pickImage(doc) },
    { keys: '\\', label: 'Switch between the result and the original', run: flip },
    ...(isAnimated(doc.get())
      ? [
          { keys: 'ArrowLeft', label: 'Previous frame', run: () => stepFrame(doc.get(), -1) },
          { keys: 'ArrowRight', label: 'Next frame', run: () => stepFrame(doc.get(), 1) },
        ]
      : []),
  ],
  StatusSlot,
  View,
};
