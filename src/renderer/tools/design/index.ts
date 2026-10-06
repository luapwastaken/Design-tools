// Colour > Design: build, check and export brand and UI palettes.
// Spec: docs/superpowers/specs/2026-09-28-colour-design-tool.md; plan unit V.
import { asSvg, unsupportedImage } from '../../lib/load.ts';
import type { ToolDefinition } from '../../shell/tool.ts';
import { toggleGreyscale } from '../common/Greyscale.tsx';
import { baseName, fetchBlob, isSvg } from '../common/take.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import { armDelete, copySelected, duplicate, escape, eyedrop, generateNow, keepAll, newPalette, nudge, roleSelected, step, toggleLocked } from './actions.ts';
import { emptyDoc, fromPayload, toPayload, type DesignDoc } from './doc.ts';
import { clearProposals } from './proposals.ts';
import { takeImage, takeSvg } from './sources.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { View } from './View.tsx';

export const tool: ToolDefinition<DesignDoc> = {
  id: 'design',
  label: 'Design',
  group: 'colour',
  icon: 'palette',
  shortcut: 1,
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
    logo: { mode: 'apply', label: 'COLOURS' },
    svg: { mode: 'apply', label: 'COLOURS' },
  },
  // images, logos and SVGs give proposals (ghost chips), never document changes: the document
  // comes back as it was
  async receive(item, _use, current) {
    switch (item.kind) {
      case 'palette':
        clearProposals(); // they were built for the palette that was open
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
    // one source of proposals at a time; the rest (a second image, an .ase) go to the Library
    return files.filter((f) => f !== file);
  },

  // the shell leaves bare keys to a focused text field (foundation 9), so none of these needs to look
  shortcuts: (doc) => [
    { keys: 'Space', label: 'Generate', run: () => generateNow(doc) },
    { keys: 'L', label: 'Lock or unlock the selected swatches', run: () => toggleLocked(doc) },
    { keys: 'Delete', label: 'Delete swatches', run: () => armDelete(doc) },
    { keys: 'Ctrl+D', label: 'Duplicate', run: () => duplicate(doc) },
    { keys: 'Ctrl+N', label: 'New palette', run: () => void newPalette() },
    { keys: 'ArrowLeft', label: 'Previous swatch', run: () => step(doc, -1) },
    { keys: 'ArrowRight', label: 'Next swatch', run: () => step(doc, 1) },
    { keys: 'Alt+ArrowLeft', label: 'Move the selection left', run: () => nudge(doc, -1) },
    { keys: 'Alt+ArrowRight', label: 'Move the selection right', run: () => nudge(doc, 1) },
    { keys: 'G', label: 'Greyscale', run: () => void toggleGreyscale() },
    { keys: 'I', label: 'Pick from screen', run: () => void eyedrop(doc) },
    { keys: 'C', label: 'Copy the hex', run: () => copySelected(doc) },
    { keys: 'A', label: 'Keep all proposals', run: () => keepAll(doc) },
    { keys: 'Escape', label: 'Discard proposals, then clear the selection', run: () => escape() },
    ...ROLES.map((role, i) => ({ keys: String(i + 1), label: `Role: ${role}`, run: () => roleSelected(doc, role) })),
    { keys: '0', label: 'Clear the role', run: () => roleSelected(doc, null) },
  ],
  StatusSlot,
  View,
};
