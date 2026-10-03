// The Halftone document bar (the Instrument board's canvas head): the image and its size, the
// Original | Result | Separations switch, another image, undo and Send to.
import { IconButton, Segmented, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { DocTitle, SendTo } from '../common/DocBar.tsx';
import { fmtPx } from '../common/names.ts';
import { pickImage, type Doc } from './actions.ts';
import type { HalftoneDoc } from './doc.ts';
import { sourcePpi } from './Output.tsx';
import { patchView, type HalftoneView, type Show } from './view-state.ts';
import s from '../common/DocBar.module.css';
import own from './View.module.css';

const SHOWS: { value: Show; label: string; tip?: string }[] = [
  { value: 'original', label: 'Original', tip: 'The image as it sits on the page, before screening (\\ switches)' },
  { value: 'result', label: 'Result' },
  { value: 'separations', label: 'Separations' },
];

export function HalftoneBar({ doc, d, v }: { doc: Doc; d: HalftoneDoc; v: HalftoneView }) {
  const src = d.source;
  const ppi = sourcePpi(d);
  return (
    <div className={s.docbar}>
      <DocTitle>{src?.name ?? 'No image'}</DocTitle>
      {src && (
        <span className={cx('lbl', own.imageSize)}>
          {fmtPx(src.w, src.h)}{ppi ? ` · ${Math.round(ppi)} ppi` : ''}
        </span>
      )}
      <IconButton icon="image" label={src ? 'Open another image' : 'Open an image'} shortcut="Ctrl+O" size="sm" onClick={() => pickImage(doc)} />
      <span className={s.grow} />
      <Segmented options={SHOWS} value={v.show} disabled={!src} onChange={(show) => patchView({ show })} fit className={s.lowerSwitch} />
      <span className={s.sep} />
      <UndoRedo doc={doc} />
      <span className={s.sep} />
      <SendTo tool="halftone" doc={doc} noun="image" empty="Open an image first: Send to hands on the screen PNG" />
    </div>
  );
}
