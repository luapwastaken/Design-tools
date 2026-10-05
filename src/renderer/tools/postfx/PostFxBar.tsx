// The Post FX document bar: the source and its size, another file, undo, Send to, Export (a menu of the formats; the shared DocBar's slots).
import { IconButton, type MenuItem } from '../../ui/index.ts';
import { DocBar, ExportMenu } from '../common/DocBar.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { pickFile, type Doc } from './actions.ts';
import type { PostFxDoc, Timeline } from './doc.ts';
import { exportWhy, type PostFxExport } from './Export.tsx';
import { fmtFps } from './media-time.ts';
import type { PostFxView } from './view-state.ts';

export function PostFxBar({ doc, d, v, t, out }: { doc: Doc; d: PostFxDoc; v: PostFxView; t: Timeline; out: PostFxExport }) {
  const src = d.source;
  const why = exportWhy(out) ?? (out.ex.busy ? 'An export is running' : null);
  const items = (): MenuItem[] => [
    ...(out.anim ? [{ label: 'GIF', icon: 'download' as const, disabled: !!out.gifWhy, hint: out.gifWhy ? 'Too big' : undefined, onSelect: () => void out.frames('gif') }] : []),
    { label: out.anim ? 'PNG of the frame on screen' : 'PNG', icon: 'download' as const, onSelect: () => void out.png() },
    ...(out.anim ? [{ label: 'PNG sequence (a folder)', icon: 'download' as const, onSelect: () => void out.frames('folder') }] : []),
    'separator' as const,
    { label: 'Copy the PNG', icon: 'content_copy' as const, onSelect: () => void out.copyPng() },
  ];
  const moving = src && src.kind !== 'image' ? ` · ${plural(t.count, 'frame')}${src.kind === 'video' ? ` · ${fmtFps(t.fps)} fps` : ''}` : '';
  return (
    <DocBar
      tool="postfx"
      doc={doc}
      title={src?.name ?? 'No image'}
      meta={src && `${fmtPx(src.w, src.h)}${moving}`}
      actions={<IconButton icon="image" label={src ? 'Open another image or clip' : 'Open an image or a clip'} shortcut="Ctrl+O" size="sm" onClick={() => pickFile(doc)} />}
      exportButton={<ExportMenu items={items} disabled={!!why} tooltip={why ?? (out.anim ? 'Export a GIF, the frame as a PNG, or a PNG sequence' : 'Export the result as a full-resolution PNG')} />}
      send={{ noun: 'image', empty: 'Open an image first: Send to hands on the result as a PNG', tip: `Hands on the result as a full-resolution PNG${t.count > 1 ? ' of the frame on screen' : ''}` }}
    />
  );
}
