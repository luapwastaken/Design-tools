// The empty state (plan unit V): one place to drop an image, a GIF or a sequence, and the other
// ways in (a file, the Library, a paste). The glyph is a ramp on a Bayer screen, so the tool says
// what it does before it's used.
import { useState, type DragEvent, type MouseEvent } from 'react';
import { shell } from '../../shell/core/index.ts';
import { Button, ITEM_MIME, menu, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { pickImage, type Doc } from './actions.ts';
import { useView } from './view-state.ts';
import s from './Start.module.css';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const COLS = 32;
const ROWS = 8;
const CELL = 4;
// the blocks a Bayer 4 × 4 screen inks along a ramp from paper to solid
const RAMP = Array.from({ length: COLS * ROWS }, (_, n) => [n % COLS, Math.floor(n / COLS)]).filter(([x, y]) => (x + 0.5) / COLS > (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16);

const Glyph = () => (
  <svg width={COLS * CELL} height={ROWS * CELL} viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    {RAMP.map(([x, y]) => (
      <rect key={`${x}.${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} />
    ))}
  </svg>
);

const TAKES = new Set(['image', 'svg', 'pattern', 'logo']);

/** everything in the Library this tool opens, by collection */
function libraryImages(): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => TAKES.has(i.kind)) })).filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No images, SVGs, patterns or logos in the Library yet', disabled: true }];
  return groups.flatMap((g) => [{ header: g.name }, ...g.items.map((ref) => ({ label: ref.name, hint: ref.kind === 'image' ? ref.ext.toUpperCase() : ref.kind.toUpperCase(), onSelect: () => void shell.sendItem(ref, 'dither') }))]);
}

export function Start({ doc }: { doc: Doc }) {
  const [over, setOver] = useState(false);
  const { times } = useView();
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
        <b className={s.title}>Drop an image to dither</b>
        <p className={s.line}>A photo, a render, a pattern or a logo: PNG, JPEG, WebP, TIFF or SVG at full resolution. An animated GIF, or several frames of a sequence at once, plays frame by frame. Ctrl V pastes one.</p>
        <div className={s.actions}>
          <Button icon="upload_file" onClick={() => pickImage(doc)} shortcut="Ctrl+O">
            Choose files
          </Button>
          <Button icon="photo_library" iconEnd="chevron_right" onClick={(e: MouseEvent<HTMLButtonElement>) => menu.open(e.currentTarget.getBoundingClientRect(), libraryImages(), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}>
            Library
          </Button>
        </div>
      </div>
      <p className={s.note}>
        It starts as a 1-bit Mac at 2 px blocks. The pixel size is the block in the file: what you see at 100% is what exports
        {times === 1 ? '' : times === 0 ? ', though the export is set to 1 px a block' : `, though the export is set to ${times} × that`}. Transparency is flattened on white.
      </p>
    </div>
  );
}
