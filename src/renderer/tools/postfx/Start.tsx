// The empty state (plan unit V): one place to drop an image, a GIF or a video, and the other ways in
// (a file, the Library, a paste). The glyph is the tool itself: an image, the divider, and the same
// image through scanlines, so it says what it does before it's used.
import { useState, type DragEvent, type MouseEvent } from 'react';
import { shell } from '../../shell/core/index.ts';
import { Button, ITEM_MIME, menu, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { pickFile, type Doc } from './actions.ts';
import s from './Start.module.css';

const W = 128;
const H = 40;
const MID = 62;
// the right half as scanlines: two px lit, two dark, as the CRT effect draws them
const LINES = Array.from({ length: H / 4 }, (_, n) => n * 4);

const Glyph = () => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="0" y="0" width={MID} height={H} fillOpacity="0.32" />
    {LINES.map((y) => (
      <rect key={y} x={MID + 3} y={y} width={W - MID - 3} height="2" />
    ))}
    <rect x={MID} y="0" width="1" height={H} />
    <rect x={MID - 3} y={H / 2 - 6} width="7" height="12" rx="1.5" />
  </svg>
);

const TAKES = new Set(['image', 'svg', 'pattern', 'logo']);

/** everything in the Library this tool opens, by collection */
function libraryImages(): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => TAKES.has(i.kind)) })).filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No images, SVGs, patterns or logos in the Library yet', disabled: true }];
  return groups.flatMap((g) => [{ header: g.name }, ...g.items.map((ref) => ({ label: ref.name, hint: ref.kind === 'image' ? ref.ext.toUpperCase() : ref.kind.toUpperCase(), onSelect: () => void shell.sendItem(ref, 'postfx') }))]);
}

export function Start({ doc }: { doc: Doc }) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(ITEM_MIME);
  return (
    <div className={s.start}>
      <div
        className={cx(s.zone, over && s.over)}
        onDragOver={(e) => {
          if (!takes(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
        // the drop itself goes on to the shell, which hands it to the tool and what it leaves to the Library (spec §9)
        onDrop={() => setOver(false)}
      >
        <div className={s.glyph}>
          <Glyph />
        </div>
        <b className={s.title}>Drop an image, a GIF or a video</b>
        <p className={s.line}>A render, a photo, a pattern or a logo at full resolution with its transparency, an animated GIF, or an MP4 or WebM clip. Ctrl V pastes an image.</p>
        <div className={s.actions}>
          <Button icon="upload_file" onClick={() => pickFile(doc)} shortcut="Ctrl+O">
            Choose a file
          </Button>
          <Button icon="photo_library" iconEnd="chevron_right" onClick={(e: MouseEvent<HTMLButtonElement>) => menu.open(e.currentTarget.getBoundingClientRect(), libraryImages(), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}>
            Library
          </Button>
        </div>
      </div>
      <p className={s.note}>Effects stack like adjustment layers, applied top to bottom. Nothing moves until you press play, and a loop ends where it began.</p>
    </div>
  );
}
