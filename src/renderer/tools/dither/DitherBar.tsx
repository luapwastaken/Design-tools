// The Dither document bar (the Instrument board's canvas head): the image and its size, the
// Original | Result switch, another image, undo and Send to.
import { IconButton, Segmented, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { DocTitle, SendTo } from '../common/DocBar.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { pickImage, type Doc } from './actions.ts';
import type { DitherDoc } from './doc.ts';
import { patchView, type DitherView, type Show } from './view-state.ts';
import s from '../common/DocBar.module.css';
import own from './View.module.css';

const SHOWS: { value: Show; label: string; tip?: string }[] = [
  { value: 'original', label: 'Original', tip: 'The image before dithering (\\ switches)' },
  { value: 'result', label: 'Result' },
];

export function DitherBar({ doc, d, v }: { doc: Doc; d: DitherDoc; v: DitherView }) {
  const src = d.source;
  return (
    <div className={s.docbar}>
      <DocTitle>{src?.name ?? 'No image'}</DocTitle>
      {src && (
        <span className={cx('lbl', own.imageSize)}>
          {fmtPx(src.w, src.h)}{src.frames > 1 ? ` · ${plural(src.frames, 'frame')}` : ''}
        </span>
      )}
      <IconButton icon="image" label={src ? 'Open another image' : 'Open an image'} shortcut="Ctrl+O" size="sm" onClick={() => pickImage(doc)} />
      <span className={s.grow} />
      <Segmented options={SHOWS} value={v.show} disabled={!src} onChange={(show) => patchView({ show })} fit className={s.lowerSwitch} />
      <span className={s.sep} />
      <UndoRedo doc={doc} />
      <span className={s.sep} />
      <SendTo tool="dither" doc={doc} noun="image" empty="Open an image first: Send to hands on the dithered PNG" tip={`Hands on the dithered PNG${src && src.frames > 1 ? ' of the frame on screen' : ''}, each block the pixel size`} />
    </div>
  );
}
