// The Halftone document bar: the image and its size, another image, the Original | Result |
// Separations switch, undo, Send to (the shared DocBar's slots).
import { IconButton, Segmented } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { fmtPx } from '../common/names.ts';
import { pickImage, type Doc } from './actions.ts';
import type { HalftoneDoc } from './doc.ts';
import { sourcePpi } from './Output.tsx';
import { patchView, type HalftoneView, type Show } from './view-state.ts';

const SHOWS: { value: Show; label: string; icon: 'image' | 'grain' | 'layers'; tip?: string }[] = [
  { value: 'original', label: 'Original', icon: 'image', tip: 'The image as it sits on the page, before screening (\\ switches)' },
  { value: 'result', label: 'Result', icon: 'grain' },
  { value: 'separations', label: 'Separations', icon: 'layers' },
];

export function HalftoneBar({ doc, d, v }: { doc: Doc; d: HalftoneDoc; v: HalftoneView }) {
  const src = d.source;
  const ppi = sourcePpi(d);
  return (
    <DocBar
      tool="halftone"
      doc={doc}
      title={src?.name ?? 'No image'}
      meta={src && `${fmtPx(src.w, src.h)}${ppi ? ` · ${Math.round(ppi)} ppi` : ''}`}
      actions={<IconButton icon="image" label={src ? 'Open another image' : 'Open an image'} shortcut="Ctrl+O" size="sm" onClick={() => pickImage(doc)} />}
      modes={<Segmented options={SHOWS} value={v.show} disabled={!src} onChange={(show) => patchView({ show })} fit />}
      send={{ noun: 'image', empty: 'Open an image first: Send to hands on the screen PNG' }}
    />
  );
}
