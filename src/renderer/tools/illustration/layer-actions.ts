// What the Layers tab's buttons and keys do. Every one is a view change (flags, parts, modes and the Rim and
// Mood are view state, never in undo) except offering the layer colours, which only proposes: nothing is
// written to the palette until a proposal is kept.
import { hexToOklch } from '../../../shared/color/index.ts';
import type { Shortcut } from '../../shell/tool.ts';
import { toast } from '../../ui/index.ts';
import { listNames } from '../common/names.ts';
import { paletteFull, type Doc } from './actions.ts';
import { proposalName, type Row } from './layers.ts';
import { propose, proposals, LAYERS_LABEL } from './proposals.ts';
import { getView, patchView, type IllustrationView } from './view-state.ts';

/** the picture's views, in key order: 1, 2 and 3 */
export const SHOWS: { id: IllustrationView['layerShow']; label: string }[] = [
  { id: 'flats', label: 'Flats' },
  { id: 'recipe', label: 'Recipe' },
  { id: 'target', label: 'Target' },
];

/** 1 to 3 pick the picture's view, only while the Layers tab shows (so they are not there on any other tab) */
export function layerKeys(doc: Doc): Shortcut[] {
  if (getView().tab !== 'layers' || !doc.get().ramps.length) return [];
  return SHOWS.map((s, i): Shortcut => ({ keys: String(i + 1), label: `Layers: show ${s.label}`, run: () => patchView({ layerShow: s.id }) }));
}

type Flag = 'layerOut' | 'layerBg' | 'layerStar';

/** a ramp's flag on or off; a list holds an id once */
export const setFlag = (flag: Flag, id: string, on: boolean): void => {
  const rest = getView()[flag].filter((x) => x !== id);
  patchView({ [flag]: on ? [...rest, id] : rest });
};

/** the part shows another ramp */
export const setPart = (part: string, ramp: string): void => patchView({ layerParts: { ...getView().layerParts, [part]: ramp } });

/** the layer colours offered to the palette as proposals, named "Shadow · Multiply 80%"; a set already offered is not offered twice */
export function offerLayers(doc: Doc, rows: Row[]): void {
  if (paletteFull(doc.get())) return;
  const items = rows.map((r) => ({ name: proposalName(r), oklch: hexToOklch(r.hex) }));
  const have = proposals.get()?.label === LAYERS_LABEL ? proposals.get()!.items : [];
  if (items.length === have.length && items.every((x, i) => have[i].name === x.name && have[i].oklch.every((v, k) => v === x.oklch[k]))) {
    return void toast.show({ icon: 'info', message: 'Already offered: keep or discard them in the Ramps panel.' });
  }
  propose(LAYERS_LABEL, items.map((x) => x.oklch), items.map((x) => x.name));
  toast.show({ icon: 'info', message: `Offered ${items.length} layer colours: ${listNames(rows.map((r) => r.name))}. Keep or discard them in the Ramps panel.` });
}
