// The Dither document bar: the image and its size, another image, the Original | Result switch,
// undo, Send to (the shared DocBar's slots).
import { IconButton, Segmented } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { pickImage, type Doc } from './actions.ts';
import type { DitherDoc } from './doc.ts';
import { patchView, type DitherView, type Show } from './view-state.ts';

const SHOWS: { value: Show; label: string; icon: 'image' | 'blur_on'; tip?: string }[] = [
  { value: 'original', label: 'Original', icon: 'image', tip: 'The image before dithering (\\ switches)' },
  { value: 'result', label: 'Result', icon: 'blur_on' },
];

export function DitherBar({ doc, d, v }: { doc: Doc; d: DitherDoc; v: DitherView }) {
  const src = d.source;
  return (
    <DocBar
      tool="dither"
      doc={doc}
      title={src?.name ?? 'No image'}
      meta={src && `${fmtPx(src.w, src.h)}${src.frames > 1 ? ` · ${plural(src.frames, 'frame')}` : ''}`}
      actions={<IconButton icon="image" label={src ? 'Open another image' : 'Open an image'} shortcut="Ctrl+O" size="sm" onClick={() => pickImage(doc)} />}
      modes={<Segmented options={SHOWS} value={v.show} disabled={!src} onChange={(show) => patchView({ show })} fit />}
      send={{ noun: 'image', empty: 'Open an image first: Send to hands on the dithered PNG', tip: `Hands on the dithered PNG${src && src.frames > 1 ? ' of the frame on screen' : ''}, each block the pixel size` }}
    />
  );
}
