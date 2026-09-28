// DEV ONLY (plan unit D): a stub palette tool so Send to, ownership, forking and undo can be
// exercised before the real tools exist, and a home for the controls board. The registry lists it
// only when not packaged; deleted when the Design tool lands.
import type { ToolDefinition } from '../../shell/tool.ts';
import { pickColours, type PaletteDoc } from './swatches.ts';
import { View } from './View.tsx';

export const tool: ToolDefinition<PaletteDoc> = {
  id: 'dev-palette',
  label: 'Dev palette',
  group: 'dev',
  icon: 'palette',
  shortcut: 8,
  docVersion: 1,
  createEmptyDoc: () => ({ swatches: [], notes: '' }),
  // no docName: the breadcrumb falls back to the linked item's name, which is the palette's name

  itemKind: 'palette',
  toItem: (d) => ({ swatches: d.swatches, notes: d.notes }),
  fromItem(item) {
    if (item.kind !== 'palette') throw new Error(`A ${item.kind} isn't a palette.`);
    return { swatches: item.payload.swatches, notes: item.payload.notes };
  },

  accepts: {
    palette: { mode: 'open', label: 'PALETTE' },
    image: { mode: 'apply', label: 'PICK COLOURS' },
  },
  async receive(item, _use, current) {
    if (item.kind === 'image') return { ...current, swatches: [...current.swatches, ...(await pickColours(item.url, item.ref.name))] };
    return tool.fromItem!(item);
  },

  View,
};
