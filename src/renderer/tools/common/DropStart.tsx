// The empty work area of the tools that start from a file (plan unit V): one place to drop, dashed
// on the pasteboard at rest and lit while a drag is over it (brief §7), the other ways in (a file,
// the Library, a paste) and a note on what the tool does first. Logo, which has two parts to fill,
// uses the frame with two zones of its own.
import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import type { ToolId } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { Button, ITEM_MIME, menu, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import s from './DropStart.module.css';

const TAKES = new Set(['image', 'svg', 'pattern', 'logo']);

/** everything in the Library an image tool opens, by collection */
function libraryImages(tool: ToolId): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => TAKES.has(i.kind)) })).filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No images, SVGs, patterns or logos in the Library yet', disabled: true }];
  return groups.flatMap((g) => [{ header: g.name }, ...g.items.map((ref) => ({ label: ref.name, hint: ref.kind === 'image' ? ref.ext.toUpperCase() : ref.kind.toUpperCase(), onSelect: () => void shell.sendItem(ref, tool) }))]);
}

export function StartFrame({ children, note }: { children: ReactNode; note: ReactNode }) {
  return (
    <div className={s.start}>
      {children}
      <p className={s.note}>{note}</p>
    </div>
  );
}

type Props = {
  tool: ToolId;
  /** a drawing of what the tool does, before it is used */
  glyph: ReactNode;
  title: string;
  line: string;
  note: ReactNode;
  choose: { label: string; onClick(): void };
};

export function DropStart({ tool, glyph, title, line, note, choose }: Props) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(ITEM_MIME);
  return (
    <StartFrame note={note}>
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
        <div className={s.glyph}>{glyph}</div>
        <b className={s.title}>{title}</b>
        <p className={s.line}>{line}</p>
        <div className={s.actions}>
          <Button icon="upload_file" onClick={choose.onClick} shortcut="Ctrl+O">
            {choose.label}
          </Button>
          <Button icon="photo_library" iconEnd="chevron_right" onClick={(e: MouseEvent<HTMLButtonElement>) => menu.open(e.currentTarget.getBoundingClientRect(), libraryImages(tool), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}>
            Library
          </Button>
        </div>
      </div>
    </StartFrame>
  );
}
