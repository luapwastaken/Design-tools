// Image > Post FX: a quick stack of effects over an image, a GIF or a clip, with the original a keypress away, and exported as a full-resolution PNG, a GIF or a PNG sequence that loops exactly.
// Spec: docs/superpowers/specs/2026-09-29-postfx-tool.md; plan unit V.
import type { ToolDefinition } from '../../shell/tool.ts';
import { fetchBlob } from '../common/take.ts';
import { arrowsFree } from '../common/keyGates.ts';
import { duplicate, moveTo, pickFile, sourceOf, takeFiles, toggleLayer, withPalette } from './actions.ts';
import { emptyDoc, fix, timeline, type PostFxDoc } from './doc.ts';
import { pngBlob } from './exports.ts';
import { postfxKeys } from './keys.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { stepFrame, togglePlay } from './Transport.tsx';
import { armed, copier, getView, pausedFrame, patchView, playhead, toggleOriginal } from './view-state.ts';
import { View } from './View.tsx';

export const tool: ToolDefinition<PostFxDoc> = {
  id: 'postfx',
  label: 'Post FX',
  group: 'image',
  icon: 'star_shine',
  shortcut: 7,
  docVersion: 1,
  createEmptyDoc: emptyDoc,
  isEmpty: (d) => !d.source,
  docName: (d) => d.source?.name ?? 'No image',

  accepts: {
    image: { mode: 'open', label: 'IMAGE' },
    pattern: { mode: 'open', label: 'IMAGE' },
    logo: { mode: 'open', label: 'IMAGE' },
    svg: { mode: 'open', label: 'IMAGE' },
    palette: { mode: 'apply', label: 'EFFECT COLOURS' },
  },
  async receive(item, _use, current) {
    if (item.kind === 'palette') return withPalette(current, item.ref.name, item.payload.swatches);
    if (!('url' in item)) return current;
    // the shell draws patterns, logos and SVGs as PNGs ("as an image"); a Library image keeps its own file
    const blob = await fetchBlob(item.url, item.ref.name);
    return fix({ ...current, source: await sourceOf(blob, item.ref.name, item.ref.kind === 'image' ? item.ref.ext.toLowerCase() : 'png') });
  },

  /** the full-resolution PNG of the frame on screen (plan unit V: at the current time) */
  async render(d) {
    if (!d.source) throw new Error('There is no image to send yet.');
    const { frame, playing } = playhead.get();
    return { blob: await pngBlob(d, playing ? frame : pausedFrame(timeline(d))), name: d.source.name, ext: 'png' };
  },

  async onFiles(files, _how, doc) {
    const left = await takeFiles(doc, files);
    return left.length === files.length ? false : left.length ? left : true;
  },

  shortcuts: (doc) =>
    postfxKeys(doc.get(), {
      selected: getView().selected,
      free: arrowsFree('postfx'),
      copy: copier.get(),
      open: () => pickFile(doc),
      original: toggleOriginal,
      select: (id) => patchView({ selected: id }),
      move: (id, to) => moveTo(doc, id, to),
      toggle: (id) => toggleLayer(doc, id),
      duplicate: (id) => duplicate(doc, id),
      arm: (id) => armed.set(id),
      step: (by) => stepFrame(timeline(doc.get()), by),
      play: () => togglePlay(timeline(doc.get())),
    }),
  StatusSlot,
  View,
};
