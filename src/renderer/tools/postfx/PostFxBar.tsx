// The Post FX document bar (the Instrument board's canvas head): the source and its size, the
// Original | Split | Result switch, another file, undo and Send to.
import { IconButton, Segmented, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { DocTitle, SendTo } from '../common/DocBar.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { pickFile, type Doc } from './actions.ts';
import type { PostFxDoc, Timeline } from './doc.ts';
import { fmtFps } from './media-time.ts';
import { patchView, type Compare, type PostFxView } from './view-state.ts';
import s from '../common/DocBar.module.css';
import own from './View.module.css';

const COMPARES: { value: Compare; label: string; tip?: string }[] = [
  { value: 'before', label: 'Original', tip: 'The original, with no effects (\\ switches)' },
  { value: 'split', label: 'Split', tip: 'The original left of the divider, the result right of it' },
  { value: 'after', label: 'Result' },
];

export function PostFxBar({ doc, d, v, t }: { doc: Doc; d: PostFxDoc; v: PostFxView; t: Timeline }) {
  const src = d.source;
  const moving = src && src.kind !== 'image' ? ` · ${plural(t.count, 'frame')}${src.kind === 'video' ? ` · ${fmtFps(t.fps)} fps` : ''}` : '';
  return (
    <div className={s.docbar}>
      <DocTitle>{src?.name ?? 'No image'}</DocTitle>
      {src && (
        <span className={cx('lbl', own.imageSize)}>
          {fmtPx(src.w, src.h)}{moving}
        </span>
      )}
      <IconButton icon="image" label={src ? 'Open another image or clip' : 'Open an image or a clip'} shortcut="Ctrl+O" size="sm" onClick={() => pickFile(doc)} />
      <span className={s.grow} />
      <Segmented options={COMPARES} value={v.compare} disabled={!src} onChange={(compare) => patchView({ compare })} fit className={s.lowerSwitch} />
      <span className={s.sep} />
      <UndoRedo doc={doc} />
      <span className={s.sep} />
      <SendTo tool="postfx" doc={doc} noun="image" empty="Open an image first: Send to hands on the result as a PNG" tip={`Hands on the result as a full-resolution PNG${t.count > 1 ? ' of the frame on screen' : ''}`} />
    </div>
  );
}
