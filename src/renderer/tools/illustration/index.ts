// Colour > Illustration: painting palettes, each base colour developed into a lit ramp, plus paint
// recipes and a scratch canvas. Spec: docs/superpowers/specs/2026-09-29-colour-illustration-tool.md; plan unit V.
import { asSvg, unsupportedImage } from '../../lib/load.ts';
import type { ToolDefinition } from '../../shell/tool.ts';
import { baseName, fetchBlob, isSvg } from '../common/take.ts';
import { arm, duplicate, eyedrop, move, newPalette, select } from './actions.ts';
import { emptyDoc, fromPayload, toPayload, type IllustrationDoc } from './doc.ts';
import { clearProposals, takeImage, takeSvg } from './proposals.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { View } from './View.tsx';

export const tool: ToolDefinition<IllustrationDoc> = {
  id: 'illustration',
  label: 'Illustration',
  group: 'colour',
  icon: 'brush',
  shortcut: 2,
  docVersion: 1,
  createEmptyDoc: emptyDoc,
  // no docName: the breadcrumb shows the palette item's name

  itemKind: 'palette',
  toItem: toPayload,
  fromItem(item) {
    if (item.kind !== 'palette') throw new Error(`A ${item.kind} isn't a palette.`);
    return fromPayload(item.payload);
  },

  accepts: {
    palette: { mode: 'open', label: 'PALETTE' },
    image: { mode: 'apply', label: 'COLOURS' },
    svg: { mode: 'apply', label: 'COLOURS' },
    logo: { mode: 'apply', label: 'COLOURS' },
  },
  // images, logos and SVGs give proposals (new base colours to add), never document changes: the
  // document comes back as it was
  async receive(item, _use, current) {
    switch (item.kind) {
      case 'palette':
        clearProposals(); // they were offered for the palette that was open
        select(null);
        return tool.fromItem!(item);
      case 'image':
        await takeImage(await fetchBlob(item.url, item.ref.name), item.ref.name);
        return current;
      case 'svg':
        takeSvg([await (await fetchBlob(item.url, item.ref.name)).text()], item.ref.name);
        return current;
      case 'logo':
        takeSvg([item.payload.preview.svg, item.payload.icon, item.payload.wordmark], item.ref.name);
        return current;
      default:
        return current;
    }
  },

  async onFiles(files) {
    const file = files.find((f) => (f.type.startsWith('image/') || isSvg(f)) && !unsupportedImage(f.type, f.name));
    if (!file) return false;
    const name = baseName(file.name);
    if (isSvg(file)) await asSvg(file.name, async () => takeSvg([await file.text()], name));
    else await takeImage(file, name);
    // one source of proposals at a time; the rest go to the Library
    return files.filter((f) => f !== file);
  },

  shortcuts: (doc) => [
    { keys: 'Delete', label: 'Delete ramp', run: () => arm(doc) },
    { keys: 'Ctrl+D', label: 'Duplicate ramp', run: () => duplicate(doc) },
    { keys: 'Ctrl+N', label: 'New palette', run: () => void newPalette() },
    { keys: 'ArrowLeft', label: 'Lighter step', run: () => move(doc, -1, 0) },
    { keys: 'ArrowRight', label: 'Darker step', run: () => move(doc, 1, 0) },
    { keys: 'I', label: 'Pick from screen', run: () => void eyedrop(doc) },
  ],
  StatusSlot,
  View,
};
