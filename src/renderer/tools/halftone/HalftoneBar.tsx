// The Halftone document bar (the Instrument board's canvas head): the image and its size, the
// Result | Separations | Original switch, another image, undo and Send to.
import { IconButton, Segmented, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { SendTo } from '../common/DocBar.tsx';
import { pickImage, type Doc } from './actions.ts';
import type { HalftoneDoc } from './doc.ts';
import { sourcePpi } from './Output.tsx';
import { patchView, type HalftoneView, type Show } from './view-state.ts';
import s from '../common/DocBar.module.css';
import own from './View.module.css';

const SHOWS: { value: Show; label: string; tip?: string }[] = [
  { value: 'result', label: 'Result' },
  { value: 'separations', label: 'Separations' },
  { value: 'original', label: 'Original', tip: 'The image as it sits on the page, before screening (\\ switches)' },
];

export function HalftoneBar({ doc, d, v }: { doc: Doc; d: HalftoneDoc; v: HalftoneView }) {
  const src = d.source;
  const ppi = sourcePpi(d);
  return (
    <div className={s.docbar}>
      <h1 className={s.title}>{src?.name ?? 'No image'}</h1>
      {src && (
        <span className={cx('lbl', own.imageSize)}>
          {src.w.toLocaleString('en')} × {src.h.toLocaleString('en')} px{ppi ? ` · ${Math.round(ppi)} ppi` : ''}
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
