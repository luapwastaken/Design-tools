// What the tool does to its document besides single values: opening an image, inks from a palette
// or an ink library, the process/spot switch, adding and removing spot inks.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import type { InkLibrary } from '../../../shared/palette/inks.ts';
import { isGround } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { decodeImage } from '../../lib/load.ts';
import { toast } from '../../ui/index.ts';
import { displayName, plural } from '../common/names.ts';
import { baseName, claims, extOf, isSvg, putAsset, svgAsPng } from '../common/take.ts';
import { freeAngle, groundIsPaper, LIMIT, processInks, spotInk, spotStart, type HalftoneDoc, type Ink } from './doc.ts';

export type Doc = DocController<HalftoneDoc>;

const ID = 'halftone';

export const LIBRARIES: { id: InkLibrary; label: string }[] = [
  { id: 'riso', label: 'Riso' },
  { id: 'ral', label: 'RAL' },
  { id: 'hks', label: 'HKS' },
  { id: 'ncs', label: 'NCS' },
];


/** read to be sure it opens, then copied into the workspace at full resolution (foundation spec §7.2) */
export async function sourceOf(blob: Blob, name: string, ext = extOf(blob, name)): Promise<NonNullable<HalftoneDoc['source']>> {
  const bmp = await decodeImage(blob, name);
  const { width: w, height: h } = bmp;
  bmp.close();
  return { asset: await putAsset(ID, blob, ext), name, w, h };
}

/** the first image among dropped or pasted files, opened as one step; the rest are left for the Library */
export async function takeFiles(doc: Doc, files: File[]): Promise<File[]> {
  const file = files.find(claims);
  if (!file) return files;
  const name = baseName(file.name);
  try {
    const source = isSvg(file) ? await sourceOf(await svgAsPng(file), name, 'png') : await sourceOf(file, name);
    doc.transact(`Open ${name}`, (d) => ({ ...d, source }));
  } catch (e) {
    toast.show({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  return files.filter((f) => f !== file);
}

/** the file picker, from the doc bar and Ctrl+O */
export function pickImage(doc: Doc): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.tif,.tiff,.svg';
  input.onchange = () => void takeFiles(doc, [...(input.files ?? [])]).then((left) => left.length && toast.show({ icon: 'block', message: `${left[0].name} isn't an image this tool can open.` }));
  input.click();
}

// the other mode's inks, so switching back finds them as they were (this session)
const stash: Partial<Record<HalftoneDoc['mode'], Ink[]>> = {};

export function setMode(doc: Doc, mode: HalftoneDoc['mode']): void {
  const d = doc.get();
  if (d.mode === mode) return;
  stash[d.mode] = d.inks;
  const inks = stash[mode] ?? (mode === 'process' ? processInks() : spotStart());
  doc.transact(mode === 'process' ? 'Print in CMYK' : 'Print in spot inks', (x) => ({ ...x, mode, inks }));
}

/**
 * A palette as spot inks (Send to: INKS, or Inks from): a swatch whose job is a ground becomes the
 * paper when the inks can print on it (groundIsPaper), the rest become inks, up to the engine's six.
 */
export function withPalette(d: HalftoneDoc, name: string, swatches: Swatch[]): HalftoneDoc {
  const ground = swatches.find((w) => w.role === 'Background') ?? swatches.find((w) => isGround(w.role));
  const colours = swatches.filter((w) => w !== ground);
  const use = (colours.length ? colours : swatches).slice(0, LIMIT.spot);
  if (!use.length) throw new Error(`${name} has no colours yet.`);
  const left = colours.length - use.length;
  const paper = ground && groundIsPaper(ground.oklch, use.map((w) => w.oklch)) ? ground : null;
  // the shell's toast says the inks came; this says what else happened
  const said = [
    left > 0 ? `Spot inks stop at ${LIMIT.spot}, so the last ${plural(left, 'colour')} of ${name} stayed out.` : '',
    paper && toHex(paper.oklch) !== toHex(d.paper.colour) ? `${displayName(paper)} became the paper.` : '',
    ground && !paper ? `${displayName(ground)} is darker than its inks, so the paper stays as it was: inks overprinted on it would come out almost black.` : '',
  ].filter(Boolean);
  if (said.length) toast.show({ icon: 'info', message: said.join(' ') });
  if (d.mode === 'process') stash.process = d.inks;
  return {
    ...d,
    mode: 'spot',
    inksFrom: { name, swatches: swatches.map((w) => ({ name: displayName(w), colour: w.oklch })) },
    inks: use.map((w, i) => spotInk(displayName(w), w.oklch, i)),
    paper: paper ? { ...d.paper, colour: paper.oklch } : d.paper,
  };
}

export function addInk(doc: Doc, name: string, colour: Oklch): void {
  const d = doc.get();
  if (d.mode !== 'spot' || d.inks.length >= LIMIT.spot) return;
  doc.transact(`Add ${name}`, (x) => ({ ...x, inks: [...x.inks, { ...spotInk(name, colour, x.inks.length), angle: freeAngle(x) }] }));
}

/** after the armed confirm: one step, and an Undo toast (brief rule 3) */
export function removeInk(doc: Doc, id: string): void {
  const ink = doc.get().inks.find((i) => i.id === id);
  if (!ink || doc.get().inks.length < 2) return;
  doc.transact(`Remove ${ink.name}`, (x) => ({ ...x, inks: x.inks.filter((i) => i.id !== id) }));
  const after = doc.get();
  toast.show({
    icon: 'delete',
    message: `Removed ${ink.name}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return void toast.show({ icon: 'info', message: 'The remove is no longer the last step. Use Undo in the tool.' });
      doc.undo();
    },
  });
}
