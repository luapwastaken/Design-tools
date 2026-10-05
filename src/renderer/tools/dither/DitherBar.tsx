// The Dither document bar: the image and its size, another image, the Original | Result switch,
// undo, Send to, Export (a menu of the formats; the shared DocBar's slots).
import { IconButton, Segmented, type MenuItem } from '../../ui/index.ts';
import { DocBar, ExportMenu } from '../common/DocBar.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { pickImage, type Doc } from './actions.ts';
import type { DitherDoc } from './doc.ts';
import type { DitherExport } from './Export.tsx';
import { patchView, type DitherView, type Show } from './view-state.ts';

const SHOWS: { value: Show; label: string; icon: 'image' | 'blur_on'; tip?: string }[] = [
  { value: 'original', label: 'Original', icon: 'image', tip: 'The image before dithering (\\ switches)' },
  { value: 'result', label: 'Result', icon: 'blur_on' },
];

export function DitherBar({ doc, d, v, out }: { doc: Doc; d: DitherDoc; v: DitherView; out: DitherExport }) {
  const src = d.source;
  const items = (): MenuItem[] => [
    ...(out.anim ? [{ label: 'GIF', icon: 'download' as const, disabled: !!out.gifWhy, hint: out.gifWhy ? 'Too big' : undefined, onSelect: () => void out.gif() }] : []),
    { label: out.anim ? 'PNG of the frame on screen' : 'PNG', icon: 'download' as const, disabled: !!out.bigPng, hint: out.bigPng ? 'Too big' : undefined, onSelect: () => void out.png() },
    { label: 'Indexed PNG', icon: 'download' as const, disabled: !!out.bigIndexed, hint: out.bigIndexed ? 'Too big' : undefined, onSelect: () => void out.indexed() },
    { label: 'SVG', icon: 'download' as const, disabled: !!out.svgWhy, hint: out.svgWhy ? 'Too large' : undefined, onSelect: () => void out.svg() },
    ...(out.anim ? [{ label: 'PNG frames (a folder)', icon: 'download' as const, disabled: !!out.bigIndexed, onSelect: () => void out.folder() }] : []),
    'separator' as const,
    { label: 'Copy the PNG', icon: 'content_copy' as const, disabled: !!out.bigPng, onSelect: () => void out.copyPng() },
  ];
  return (
    <DocBar
      tool="dither"
      doc={doc}
      title={src?.name ?? 'No image'}
      meta={src && `${fmtPx(src.w, src.h)}${src.frames > 1 ? ` · ${plural(src.frames, 'frame')}` : ''}`}
      actions={<IconButton icon="image" label={src ? 'Open another image' : 'Open an image'} shortcut="Ctrl+O" size="sm" onClick={() => pickImage(doc)} />}
      modes={<Segmented options={SHOWS} value={v.show} disabled={!src} onChange={(show) => patchView({ show })} fit />}
      exportButton={<ExportMenu items={items} disabled={!!out.why} tooltip={out.why ?? 'Export a PNG, an indexed PNG or an SVG at the scale in the Export group'} />}
      send={{ noun: 'image', empty: 'Open an image first: Send to hands on the dithered PNG', tip: `Hands on the dithered PNG${src && src.frames > 1 ? ' of the frame on screen' : ''}, each block the pixel size` }}
    />
  );
}
