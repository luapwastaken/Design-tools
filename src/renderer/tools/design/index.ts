// Colour > Design: build, check and export brand and UI palettes.
// Spec: docs/superpowers/specs/2026-09-28-colour-design-tool.md; plan unit V.
import { asSvg, unsupportedImage } from '../../lib/load.ts';
import { isLive, keysOf, parseCombo, sameCombo } from '../../shell/core/keys.ts';
import type { Shortcut, ToolDefinition } from '../../shell/tool.ts';
import { toggleGreyscale } from '../common/Greyscale.tsx';
import { toggleValueLock } from '../../ui/PickerStyles.tsx';
import { copyOff } from '../common/keyGates.ts';
import { copyPalette } from '../common/ExportPalette.tsx';
import { baseName, fetchBlob, isSvg } from '../common/take.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import { addSwatch, armDelete, copySelected, duplicate, escape, eyedrop, keepAll, lockImported, newPalette, nudge, roleSelected, selectAll, spaceNow, step, toggleLocked } from './actions.ts';
import { emptyDoc, fromPayload, named, TAB_LABEL, tabsOf, toPayload, type DesignDoc } from './doc.ts';
import { clearProposals } from './proposals.ts';
import { takeImage, takeSvg } from './sources.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { swapSelected, variationKeys } from './variation-actions.ts';
import { getView, patchView } from './view-state.ts';
import { View } from './View.tsx';

/** the first live row to take a key keeps it: a later row with the same key (Design's Space under the Variations tab's) goes off, so the sheet dims it and no two live rows share one */
function shadowed(list: Shortcut[]): Shortcut[] {
  const taken: NonNullable<ReturnType<typeof parseCombo>>[] = [];
  return list.map((s) => {
    if (!isLive(s)) return s;
    const combos = keysOf(s).flatMap((k) => parseCombo(k) ?? []);
    if (combos.some((c) => taken.some((t) => sameCombo(t, c)))) return { ...s, off: true };
    taken.push(...combos);
    return s;
  });
}

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
        {
          const doc = tool.fromItem!(item);
          lockImported(doc.swatches);
          return doc;
        }
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
  shortcuts: (doc) => {
    const copyOne = { label: 'Copy the selected colour', group: 'Copy and export', run: () => copySelected(doc) };
    return shadowed([
      // the first of each group opens it on the sheet in the picture's order; none shares keys with the Variations rows below, so what is live stays as it was
      { keys: 'Shift+A', label: 'Add a colour next to the selected one', group: 'Make colours', run: () => addSwatch(doc) },
      { keys: 'Ctrl+A', label: 'Select all colours', group: 'Select and arrange', run: () => selectAll(doc) },
      // the tab strip's own order (View.tsx puts the same Alt+N in each tab's tooltip)
      ...tabsOf(doc.get()).map((id, i) => ({ keys: `Alt+${i + 1}`, label: `Tab: ${TAB_LABEL[id]}`, group: 'View', run: () => patchView({ tab: id, tabChosen: true }) })),
      // then the Variations tab's 1 to 6, Space, arrows and Esc, which win while it shows (and are off on any other tab)
      ...variationKeys(doc),
      { keys: 'Space', label: 'Reroll the unlocked colours (builds a palette when empty)', group: 'Make colours', run: () => spaceNow(doc) },
      { keys: 'L', label: 'Lock or unlock (kept through Reroll and Delete)', group: 'Select and arrange', run: () => toggleLocked(doc) },
      { keys: 'S', label: 'Other colours for the selected role', group: 'Make colours', run: () => swapSelected(doc) },
      { keys: 'V', label: 'Hold value: keep the lightness while you edit', group: 'View', run: toggleValueLock },
      { keys: 'Delete', also: ['Backspace'], label: 'Delete the selected colours (asks first)', group: 'Select and arrange', run: () => armDelete(doc) },
      { keys: 'Ctrl+D', label: 'Duplicate the selected colour', group: 'Make colours', run: () => duplicate(doc) },
      { keys: 'Ctrl+N', label: 'New palette', group: 'Make colours', run: () => void newPalette(doc) },
      { keys: 'ArrowLeft', label: 'Previous colour', group: 'Select and arrange', run: () => step(doc, -1) },
      { keys: 'ArrowRight', label: 'Next colour', group: 'Select and arrange', run: () => step(doc, 1) },
      { keys: 'Alt+ArrowLeft', label: 'Move the selected colours left', group: 'Select and arrange', run: () => nudge(doc, -1) },
      { keys: 'Alt+ArrowRight', label: 'Move the selected colours right', group: 'Select and arrange', run: () => nudge(doc, 1) },
      { keys: 'G', label: 'Show or hide greyscale', group: 'View', run: () => void toggleGreyscale() },
      { keys: 'I', label: 'Pick a colour from the screen', group: 'Make colours', run: () => void eyedrop(doc) },
      // C stays live with text selected; Ctrl+C is the page's then (a field or a selection), so it is its own row
      // one row on the sheet: while text is selected or a field has focus, both keys are the page's
      { keys: 'C', also: ['Ctrl+C'], ...copyOne, off: copyOff() },
      {
        keys: 'Ctrl+Shift+C',
        label: 'Copy every colour in the export format',
        group: 'Copy and export',
        run: () => void copyPalette({ tool: 'design', swatches: doc.get().swatches, named: (l) => named(l, doc.get().ramps), format: getView().format }),
      },
      // Ctrl+V is the paste event's; a live entry here would preventDefault it
      { keys: 'Ctrl+V', label: 'Paste colour codes or an image', group: 'Make colours' },
      { keys: 'A', label: 'Keep all proposals', group: 'Make colours', run: () => keepAll(doc) },
      { keys: 'Escape', label: 'Cancel a delete, discard proposals, then clear the selection', group: 'Make colours', run: () => escape() },
      ...ROLES.map((role, i) => ({ keys: String(i + 1), label: `Role: ${role}`, group: 'Select and arrange', run: () => roleSelected(doc, role) })),
      { keys: '0', label: 'Clear the role', group: 'Select and arrange', run: () => roleSelected(doc, null) },
    ]);
  },
  StatusSlot,
  View,
};
