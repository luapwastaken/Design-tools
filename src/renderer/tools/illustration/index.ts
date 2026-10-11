// Colour > Illustration: painting palettes, each base colour developed into a lit ramp, plus paint
// recipes and a scratch canvas. Spec: docs/superpowers/specs/2026-09-29-colour-illustration-tool.md; plan unit V.
import { asSvg, unsupportedImage } from '../../lib/load.ts';
import type { ToolDefinition } from '../../shell/tool.ts';
import { toggleGreyscale } from '../common/Greyscale.tsx';
import { copyColours } from '../../ui/index.ts';
import { toggleValueLock } from '../../ui/PickerStyles.tsx';
import { copyPalette } from '../common/ExportPalette.tsx';
import { arrowsFree, copyOff } from '../common/keyGates.ts';
import { plural } from '../common/names.ts';
import { baseName, fetchBlob, isSvg } from '../common/take.ts';
import { addBase, addProposals, arm, duplicate, eyedrop, move, newPalette, reorder, select, selected } from './actions.ts';
import { emptyDoc, fromPayload, named, rampName, rampOf, setSpec, stepsOf, toPayload, type IllustrationDoc } from './doc.ts';
import { illustrationKeys } from './keys.ts';
import { paintSettings, stepLoad, stepSize, type PaintSettings } from './paint-sources.ts';
import { clearProposals, proposals, takeImage, takeSvg } from './proposals.ts';
import { sceneLight, sceneNotes } from './scene.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { SHOWS } from './layer-actions.ts';
import { adoptCell, closeCell, closeSwap, lockSelected, moreLikeThis, newSet, showCell, stepCell, toggleSwap } from './variation-actions.ts';
import { cellsOf, openCell } from './variations.ts';
import { View } from './View.tsx';
import { getView, patchView, type IllustrationView } from './view-state.ts';

/** the canvas's settings, written whole */
const setPaint = (patch: Partial<PaintSettings>) => patchView({ canvas: { ...paintSettings(getView().canvas), ...patch } });

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
    const d = doc.get();
    const v = getView();
    const sel = selected(d);
    const ramp = rampOf(d, sel?.group);
    const cells = v.tab === 'variations' && d.ramps.length ? cellsOf(d, v) : [];
    const open = openCell(cells, v);
    const swapOpen = !!v.swapRamp && !!rampOf(d, v.swapRamp);
    const paint = paintSettings(v.canvas);
    const hero = () => {
      if (ramp) doc.transact(ramp.hero ? 'End the hero colour' : 'Make the hero colour', (x) => setSpec(x, ramp.id, { hero: !ramp.hero }));
    };
    const light = sceneLight(d);
    return illustrationKeys(
      {
        tab: v.tab,
        swatches: d.swatches.length > 0,
        ramps: d.ramps.length > 0,
        ramp: !!ramp,
        swapOpen,
        cells: cells.length,
        cellOpen: !!open,
        onControl: !!document.activeElement?.closest('button, a[href], input, textarea, [role="tab"], [role="menuitem"]'),
        proposals: !!proposals.get(),
        copyOff: copyOff(),
        // the ramps and the swatch board; focus in an inspector keeps its own arrows
        arrowsFree: arrowsFree('illustration', '[aria-label="Ramps"], [aria-label="Swatch board"]'),
      },
      {
        // Light and Check have nothing to show with no colour
        tab: (t) => (d.swatches.length || t === 'settings' || t === 'paint' ? patchView({ tab: t }) : undefined),
        addColour: () => addBase(doc),
        arm: () => arm(doc),
        duplicate: () => duplicate(doc),
        newPalette: () => void newPalette(doc),
        step: (dx, dy) => move(doc, dx, dy),
        moveRamp: (dir) => {
          const i = ramp ? d.ramps.indexOf(ramp) : -1;
          // the index is where it lands before it leaves, so one down is two on
          if (i >= 0 && i + dir >= 0 && i + dir < d.ramps.length) reorder(doc, ramp!.id, dir < 0 ? i - 1 : i + 2);
        },
        hero,
        lock: () => lockSelected(doc),
        swap: () => ramp && toggleSwap(ramp.id),
        closeSwap,
        keepAll: () => addProposals(doc, proposals.get()?.items ?? [], true),
        discard: clearProposals,
        greyscale: () => void toggleGreyscale(),
        holdValue: toggleValueLock,
        eyedrop: () => void eyedrop(doc),
        paintTool: (t) => setPaint({ tool: t }),
        size: (dir) => setPaint({ size: stepSize(paint.size, dir) }),
        load: (dir) => setPaint({ load: stepLoad(paint.load, dir) }),
        copyRamp: () => {
          if (!ramp) return;
          const steps = stepsOf(d, ramp.id);
          void copyColours(steps.map((w) => w.oklch), `${rampName(d, ramp)}'s ${plural(steps.length, 'colour')}`);
        },
        copyAll: () =>
          void copyPalette({ tool: 'illustration', swatches: d.swatches, named: () => named(doc.get()), scene: d.ramps.length && !light.mixed ? light.pair : null, notes: sceneNotes(d), format: v.format }),
        show: showCell,
        newSet,
        cellStep: (dir) => stepCell(cells.length, dir),
        more: () => moreLikeThis(d),
        use: () => open && adoptCell(doc, open),
        closeCell,
        layerShow: (i) => patchView({ layerShow: SHOWS[i].id }),
      },
    );
  },
  StatusSlot,
  View,
};
