// The Post FX document bar: the source and its size, another file, the Original | Split | Result
// switch, undo, Send to (the shared DocBar's slots).
import { IconButton, Segmented } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { pickFile, type Doc } from './actions.ts';
import type { PostFxDoc, Timeline } from './doc.ts';
import { fmtFps } from './media-time.ts';
import { patchView, type Compare, type PostFxView } from './view-state.ts';

const COMPARES: { value: Compare; label: string; icon: 'image' | 'swap_horiz' | 'wand_stars'; tip?: string }[] = [
  { value: 'before', label: 'Original', icon: 'image', tip: 'The original, with no effects (\\ switches)' },
  { value: 'split', label: 'Split', icon: 'swap_horiz', tip: 'The original left of the divider, the result right of it' },
  { value: 'after', label: 'Result', icon: 'wand_stars' },
];

export function PostFxBar({ doc, d, v, t }: { doc: Doc; d: PostFxDoc; v: PostFxView; t: Timeline }) {
  const src = d.source;
  const moving = src && src.kind !== 'image' ? ` · ${plural(t.count, 'frame')}${src.kind === 'video' ? ` · ${fmtFps(t.fps)} fps` : ''}` : '';
  return (
    <DocBar
      tool="postfx"
      doc={doc}
      title={src?.name ?? 'No image'}
      meta={src && `${fmtPx(src.w, src.h)}${moving}`}
      actions={<IconButton icon="image" label={src ? 'Open another image or clip' : 'Open an image or a clip'} shortcut="Ctrl+O" size="sm" onClick={() => pickFile(doc)} />}
      modes={<Segmented options={COMPARES} value={v.compare} disabled={!src} onChange={(compare) => patchView({ compare })} fit />}
      send={{ noun: 'image', empty: 'Open an image first: Send to hands on the result as a PNG', tip: `Hands on the result as a full-resolution PNG${t.count > 1 ? ' of the frame on screen' : ''}` }}
    />
  );
}
