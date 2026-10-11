// The Halftone document bar: the image and its size, another image, the Original | Result |
// Separations switch, undo, Send to, Export (a menu of the formats; the shared DocBar's slots).
import { IconButton, Segmented, type MenuItem } from '../../ui/index.ts';
import { DocBar, ExportMenu } from '../common/DocBar.tsx';
import { fmtPx } from '../common/names.ts';
import { pickImage, type Doc } from './actions.ts';
import type { HalftoneDoc } from './doc.ts';
import type { HalftoneExport } from './Export.tsx';
import { sourcePpi } from './Output.tsx';
import { patchView, type HalftoneView, type Show } from './view-state.ts';

const SHOWS: { value: Show; label: string; icon: 'image' | 'grain' | 'layers'; tip?: string }[] = [
  { value: 'original', label: 'Original', icon: 'image', tip: 'The image as it sits on the page, before screening (Y or \\ switches)' },
  { value: 'result', label: 'Result', icon: 'grain' },
  { value: 'separations', label: 'Separations', icon: 'layers' },
];

export function HalftoneBar({ doc, d, v, out }: { doc: Doc; d: HalftoneDoc; v: HalftoneView; out: HalftoneExport }) {
  const src = d.source;
  const items = (): MenuItem[] => [
    { label: 'SVG for Illustrator', icon: 'download', disabled: !!out.svgWhy, hint: out.svgWhy ? 'Not available' : undefined, onSelect: () => void out.svg() },
    ...(out.visible.length > 1 ? [{ label: 'SVG, one file per ink (a folder)', icon: 'download' as const, disabled: !!out.svgInkWhy, hint: out.svgInkWhy ? 'Not available' : undefined, onSelect: () => void out.svgPerInk() }] : []),
    { label: 'PNG for screen', icon: 'download', disabled: !!out.pngProblem, hint: out.pngProblem ? 'Too big' : undefined, onSelect: () => void out.png() },
    { label: 'Separations (a folder of plates)', icon: 'download', disabled: !!out.plateProblem, hint: out.plateProblem ? 'Too big' : undefined, onSelect: () => void out.plates() },
    'separator',
    { label: 'Copy the PNG', icon: 'content_copy', disabled: !!out.pngProblem, onSelect: () => void out.copyPng() },
  ];
  const ppi = sourcePpi(d);
  return (
    <DocBar
      tool="halftone"
      doc={doc}
      title={src?.name ?? 'No image'}
      meta={src && `${fmtPx(src.w, src.h)}${ppi ? ` · ${Math.round(ppi)} ppi` : ''}`}
      actions={<IconButton icon="image" label={src ? 'Open another image' : 'Open an image'} shortcut="Ctrl+O" size="sm" onClick={() => pickImage(doc)} />}
      modes={<Segmented options={SHOWS} value={v.show} disabled={!src} onChange={(show) => patchView({ show })} fit />}
      exportButton={<ExportMenu items={items} disabled={!!out.why} tooltip={out.why ?? 'Export the SVG, the screen PNG or the separations (their sizes are in the Export group)'} />}
      send={{ noun: 'image', empty: 'Open an image first: Send to hands on the screen PNG' }}
    />
  );
}
