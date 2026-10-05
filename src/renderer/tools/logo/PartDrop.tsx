// A place a part goes in: drop an SVG or PNG on it (a file or a Library item), choose a file, pick
// one from the Library, or paste SVG markup. The empty stage has two; an empty slot in Parts one.
import { useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { shell } from '../../shell/core/index.ts';
import { Button, IconButton, InfoTip, ITEM_MIME, menu, toast, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { pasteInto, sendInto, takeFiles, type Doc } from './actions.ts';
import type { Role } from './doc.ts';
import { loading } from './view-state.ts';
import s from './PartDrop.module.css';

/** Library SVGs and images, by collection; picking one sends it into `role` */
export function libraryParts(role: Role): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? [])
    .map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => i.kind === 'svg' || i.kind === 'image') }))
    .filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No SVGs or images in the Library yet', disabled: true }];
  return groups.flatMap((g) => [
    { header: g.name },
    ...g.items.map((ref) => ({ label: ref.name, hint: ref.kind === 'svg' ? 'SVG' : ref.ext.toUpperCase(), onSelect: () => void sendInto(ref, role) })),
  ]);
}

export const openMenu = (e: MouseEvent<HTMLButtonElement>, items: MenuItem[]) =>
  menu.open(e.currentTarget.getBoundingClientRect(), items, { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });

/** drag-over and drop for one part: OS files and Library items, taken here so the whole tool doesn't light up */
export function usePartDrop(doc: Doc, role: Role) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(ITEM_MIME);
  return {
    over,
    handlers: {
      onDragOver(e: DragEvent<HTMLElement>) {
        if (!takes(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave(e: DragEvent<HTMLElement>) {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop(e: DragEvent<HTMLElement>) {
        if (!takes(e)) return;
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(ITEM_MIME);
        if (id) {
          const ref = shell.getState().library?.collections.flatMap((c) => c.items).find((i) => i.id === id);
          if (!ref) return;
          // a part is an SVG or an image; anything else goes where it would anyway
          return void (ref.kind === 'svg' || ref.kind === 'image' ? sendInto(ref, role) : shell.openItem(ref));
        }
        const files = [...e.dataTransfer.files];
        void takeFiles(doc, files, role).then((left) => {
          if (left.length === files.length) toast.show({ icon: 'block', message: `${left[0]?.name ?? 'That'} isn't an SVG or an image. Drop an SVG, or a PNG with a transparent background.` });
        });
      },
    },
  };
}

/** the hidden file input and what opens it */
export function useFilePick(doc: Doc, role: Role) {
  const input = useRef<HTMLInputElement>(null);
  return {
    pick: () => input.current?.click(),
    input: (
      <input
        ref={input}
        type="file"
        accept=".svg,image/svg+xml,image/png,image/webp,image/gif,image/avif"
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          void takeFiles(doc, files, role);
        }}
      />
    ),
  };
}

const WORD: Record<Role, { title: string; line: string }> = {
  icon: { title: 'Icon', line: 'The mark on its own: a symbol, a monogram, a badge.' },
  wordmark: { title: 'Wordmark', line: 'The name as drawn artwork. Its cap height and baseline are found from the letters.' },
};

/** the large zone the empty stage shows, one per part */
export function PartZone({ doc, role, glyph }: { doc: Doc; role: Role; glyph: ReactNode }) {
  const { over, handlers } = usePartDrop(doc, role);
  const { pick, input } = useFilePick(doc, role);
  const busy = loading.use().includes(role);
  return (
    <div className={cx(s.zone, over && s.over)} {...handlers}>
      <div className={s.glyph} aria-hidden>
        {glyph}
      </div>
      <span className={s.title}>
        {WORD[role].title}
        <InfoTip text={WORD[role].line} />
        {busy && <span className={s.reading}>Reading…</span>}
      </span>
      <div className={s.actions}>
        <Button icon="upload_file" onClick={pick} disabled={busy}>
          Choose file
        </Button>
        <Button icon="photo_library" iconEnd="chevron_right" onClick={(e) => openMenu(e, libraryParts(role))} disabled={busy}>
          Library
        </Button>
        <IconButton icon="content_paste" label="Paste SVG markup" onClick={() => void pasteInto(doc, role)} disabled={busy} />
      </div>
      {input}
    </div>
  );
}

/** an empty slot as a row (the Parts group): drop here, or choose */
export function PartSlot({ doc, role, className }: { doc: Doc; role: Role; className?: string }) {
  const { over, handlers } = usePartDrop(doc, role);
  const { pick, input } = useFilePick(doc, role);
  const busy = loading.use().includes(role);
  return (
    <div className={cx(s.slot, over && s.over, className)} {...handlers}>
      <div className={s.slotText}>
        <b>{busy ? 'Reading…' : role === 'icon' ? 'Add an icon' : 'Add a wordmark'}</b>
      </div>
      <IconButton icon="upload_file" label={`Choose the ${role} file`} size="sm" onClick={pick} disabled={busy} />
      <IconButton icon="photo_library" label={`Pick the ${role} from the Library`} size="sm" onClick={(e) => openMenu(e, libraryParts(role))} disabled={busy} />
      {input}
    </div>
  );
}
