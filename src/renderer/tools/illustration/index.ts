// Colour > Illustration: painting palettes, each base colour developed into a lit ramp, plus paint
// recipes and a scratch canvas. Spec: docs/superpowers/specs/2026-09-29-colour-illustration-tool.md; plan unit V.
import { asSvg, unsupportedImage } from '../../lib/load.ts';
import type { ToolDefinition } from '../../shell/tool.ts';
import { toggleGreyscale } from '../common/Greyscale.tsx';
import { toggleValueLock } from '../../ui/PickerStyles.tsx';
import { baseName, fetchBlob, isSvg } from '../common/take.ts';
import { addBase, arm, duplicate, eyedrop, move, newPalette, select, selected } from './actions.ts';
import { emptyDoc, fromPayload, rampOf, setSpec, toPayload, type IllustrationDoc } from './doc.ts';
import { paintSettings, SIZE, LOAD, type PaintSettings } from './paint-sources.ts';
import { clearProposals, takeImage, takeSvg } from './proposals.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { lockSelected, variationKeys } from './variation-actions.ts';
import { View } from './View.tsx';
import { getView, patchView, type IllustrationView } from './view-state.ts';

type Mode = IllustrationView['tab'];
const inPaint = () => getView().tab === 'paint';
/** the canvas's settings, written whole */
const setPaint = (patch: Partial<PaintSettings>) => patchView({ canvas: { ...paintSettings(getView().canvas), ...patch } });
const bump = (key: 'size' | 'load', by: number, range: { min: number; max: number }) => {
  const cur = paintSettings(getView().canvas)[key];
  // the size steps by a fifth (at least 1), as the canvas's own [ and ] do; the load by `by`
  const next = key === 'load' ? cur + by : by > 0 ? Math.max(cur + 1, Math.round(cur * 1.2)) : Math.min(cur - 1, Math.round(cur / 1.2));
  setPaint({ [key]: Math.min(range.max, Math.max(range.min, next)) });
};

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

  shortcuts: (doc) => {
    // Light and Check have nothing to show with no colour
    const mode = (m: Mode) => () => doc.get().swatches.length || m === 'settings' || m === 'paint' ? patchView({ tab: m }) : undefined;
    const hero = () => {
      const r = rampOf(doc.get(), selected(doc.get())?.group);
      if (r) doc.transact(r.hero ? 'End the hero colour' : 'Make the hero colour', (d) => setSpec(d, r.id, { hero: !r.hero }));
    };
    return [
      // first, so the Variations tab's 1 to 6, Space, arrows and Esc win while it shows (and are not there on any other tab)
      ...variationKeys(doc),
      { keys: 'Alt+1', label: 'Ramp settings', run: mode('settings') },
      { keys: 'Alt+2', label: 'Light & preview', run: mode('light') },
      { keys: 'Alt+3', label: 'Light zones', run: mode('zones') },
      { keys: 'Alt+4', label: 'Check values', run: mode('check') },
      { keys: 'Alt+5', label: 'Paint', run: mode('paint') },
      { keys: 'Alt+6', label: 'Variations', run: mode('variations') },
      { keys: 'Shift+A', label: 'Add a colour', run: () => addBase(doc) },
      { keys: 'Delete', label: 'Delete ramp', run: () => arm(doc) },
      { keys: 'Ctrl+D', label: 'Duplicate ramp', run: () => duplicate(doc) },
      { keys: 'Ctrl+N', label: 'New palette', run: () => void newPalette(doc) },
      { keys: 'ArrowLeft', label: 'Lighter step', run: () => move(doc, -1, 0) },
      { keys: 'ArrowRight', label: 'Darker step', run: () => move(doc, 1, 0) },
      { keys: 'H', label: 'Hero colour', run: hero },
      { keys: 'L', label: 'Lock or unlock the selected ramp: it keeps its colour in every Variations cell', run: () => lockSelected(doc) },
      { keys: 'G', label: 'Greyscale', run: () => void toggleGreyscale() },
      { keys: 'V', label: 'Hold value', run: toggleValueLock },
      // I picks: on the paper in Paint, anywhere on screen otherwise
      { keys: 'I', label: 'Pick', run: () => (inPaint() ? setPaint({ tool: 'pick' }) : void eyedrop(doc)) },
      { keys: 'B', label: 'Brush', run: () => inPaint() && setPaint({ tool: 'paint' }) },
      { keys: 'S', label: 'Smudge', run: () => inPaint() && setPaint({ tool: 'smudge' }) },
      { keys: '[', label: 'Smaller brush', run: () => inPaint() && bump('size', -1, SIZE) },
      { keys: ']', label: 'Larger brush', run: () => inPaint() && bump('size', 1, SIZE) },
      { keys: 'Shift+{', label: 'Less load', run: () => inPaint() && bump('load', -5, LOAD) },
      { keys: 'Shift+}', label: 'More load', run: () => inPaint() && bump('load', 5, LOAD) },
    ];
  },
  StatusSlot,
  View,
};
