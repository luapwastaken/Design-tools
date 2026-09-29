// The empty state (plan unit V): one place to drop an image, and the other ways in (a file, the
// Library, a paste). The glyph is a halftone ramp, so the tool says what it does before it's used.
import { useState, type DragEvent, type MouseEvent } from 'react';
import { shell } from '../../shell/core/index.ts';
import { Button, ITEM_MIME, menu, toast, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { pickImage, takeFiles, type Doc } from './actions.ts';
import s from './Start.module.css';

// a ramp of round dots on a 45° screen, from bare paper to nearly solid
const RAMP = Array.from({ length: 9 * 5 }, (_, n) => {
  const [i, j] = [n % 9, Math.floor(n / 9)];
  const cx = 8 + i * 13 + (j % 2 ? 6.5 : 0);
  const cy = 8 + j * 13;
  return { cx, cy, r: Math.max(0.6, Math.sqrt((0.06 + (cx / 124) * 0.8) / Math.PI) * 13 * 0.62) };
});

const Glyph = () => (
  <svg width="128" height="64" viewBox="0 0 128 64" fill="currentColor" aria-hidden="true">
    {RAMP.filter((d) => d.cx < 124).map((d, k) => (
      <circle key={k} cx={d.cx} cy={d.cy} r={d.r} />
    ))}
  </svg>
);

const TAKES = new Set(['image', 'svg', 'pattern', 'logo']);

/** everything in the Library this tool opens, by collection */
function libraryImages(): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => TAKES.has(i.kind)) })).filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No images, SVGs, patterns or logos in the Library yet', disabled: true }];
  return groups.flatMap((g) => [{ header: g.name }, ...g.items.map((ref) => ({ label: ref.name, hint: ref.kind === 'image' ? ref.ext.toUpperCase() : ref.kind.toUpperCase(), onSelect: () => void shell.sendItem(ref, 'halftone') }))]);
}

export function Start({ doc }: { doc: Doc }) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(ITEM_MIME);
  const drop = (e: DragEvent<HTMLElement>) => {
    if (!takes(e)) return;
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(ITEM_MIME);
    if (id) {
      const ref = shell.getState().library?.collections.flatMap((c) => c.items).find((i) => i.id === id);
      return void (ref && shell.openItem(ref));
    }
    const files = [...e.dataTransfer.files];
    void takeFiles(doc, files).then((left) => left.length === files.length && toast.show({ icon: 'block', message: `${left[0]?.name ?? 'That'} isn't an image. Drop a PNG, JPEG, WebP, TIFF, GIF or SVG.` }));
  };
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
        onDrop={drop}
      >
        <div className={s.glyph}>
          <Glyph />
        </div>
        <b className={s.title}>Drop an image to screen</b>
        <p className={s.line}>A render, a photo, a pattern or a logo: PNG, JPEG, WebP, TIFF (16-bit ones read at 8-bit precision), GIF or SVG, at full resolution with its transparency. Ctrl V pastes one.</p>
        <div className={s.actions}>
          <Button icon="upload_file" onClick={() => pickImage(doc)} shortcut="Ctrl+O">
            Choose file
          </Button>
          <Button icon="photo_library" iconEnd="chevron_right" onClick={(e: MouseEvent<HTMLButtonElement>) => menu.open(e.currentTarget.getBoundingClientRect(), libraryImages(), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}>
            Library
          </Button>
        </div>
      </div>
      <p className={s.note}>It prints to A4 at 300 DPI and 60 lines to the inch until you change the output size. What you see is what prints: the SVG, the PNG and the plates are drawn from the same dots.</p>
    </div>
  );
}
