import { useRef, useSyncExternalStore } from 'react';
import { COPY_FORMATS, formatColour, type CopyFormat } from '../../shared/color/format.ts';
import type { Oklch } from '../../shared/color/index.ts';
import { ipc } from '../shell/core/ipc.ts';
import { IconButton } from './IconButton.tsx';
import { menu } from './menu.ts';
import { toast } from './toast.ts';
import s from './Picker.module.css';

// Copy for a colour: the button repeats the last format, the caret beside it opens the Copy as menu.
// The format is remembered across sessions (a per-machine convenience, so browser storage).

const KEY = 'copyAs';
const known = (v: unknown): v is CopyFormat => COPY_FORMATS.some((f) => f.id === v);
let format: CopyFormat = 'hex';
try {
  const saved = localStorage.getItem(KEY);
  if (known(saved)) format = saved;
} catch {}
const listeners = new Set<() => void>();

export const useCopyFormat = (): CopyFormat =>
  useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => format,
  );

function remember(next: CopyFormat) {
  format = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  listeners.forEach((fn) => fn());
}

/** The colour as text on the clipboard, in this format or the remembered one, through main (a test run writes to memory). */
export async function copyColour(o: Oklch, as: CopyFormat = format): Promise<void> {
  const text = formatColour(o, as);
  try {
    await ipc.invoke('clipboard.copy', { kind: 'text', data: text });
    toast.show({ icon: 'content_copy', message: <>Copied <b>{text}</b></> });
  } catch {
    toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." });
  }
}

export function CopyAs({ value }: { value: Oklch }) {
  const current = useCopyFormat();
  const caret = useRef<HTMLButtonElement>(null);
  const open = () => {
    const el = caret.current!;
    menu.open(
      el.getBoundingClientRect(),
      [
        { header: 'Copy as' },
        ...COPY_FORMATS.map((f) => ({
          label: f.label,
          hint: formatColour(value, f.id),
          checked: f.id === current,
          onSelect: () => {
            remember(f.id);
            void copyColour(value, f.id);
          },
        })),
      ],
      { owner: el, width: 360, initial: 1 + COPY_FORMATS.findIndex((f) => f.id === current) },
    );
  };
  return (
    <span className={s.copyAs}>
      <IconButton icon="content_copy" label={`Copy ${COPY_FORMATS.find((f) => f.id === current)!.label}`} onClick={() => void copyColour(value)} />
      <IconButton ref={caret} icon="keyboard_arrow_down" size="xs" label="Copy as" onClick={open} />
    </span>
  );
}
