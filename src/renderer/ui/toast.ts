import type { ReactNode } from 'react';
import type { IconName } from '../shell/tool.ts';

// Toasts: an imperative store so any handler can show one; <ToastHost /> draws them.
// Undo toasts stay 8s, paused while hovered or while the window is unfocused; error toasts stay
// until dismissed (brief §6). At most three show; a fourth closes the oldest.

export type ToastOptions = {
  icon?: IconName;
  message: ReactNode;
  kind?: 'info' | 'error';
  undo?: () => void | Promise<void>;
  /** false: this toast's Undo never answers Ctrl+Z */
  ctrlZ?: boolean;
  /** ms; default 8000 with undo, 5000 without, until dismissed for errors */
  duration?: number;
  onClose?(reason: 'timeout' | 'undo' | 'dismiss'): void;
};

export type ToastEntry = ToastOptions & {
  id: string;
  /** Ctrl+Z still means this toast's Undo: no tool commit since it appeared (spec §8) */
  ctrlZLive: boolean;
  leaving: boolean;
};

const MAX = 3;
export const LEAVE_MS = 90;

let list: ToastEntry[] = [];
const timers = new Map<string, { left: number; since: number; handle?: ReturnType<typeof setTimeout>; holds: Set<string> }>();
const listeners = new Set<() => void>();
const emit = (next: ToastEntry[]) => {
  list = next;
  listeners.forEach((f) => f());
};

function close(id: string, reason: 'timeout' | 'undo' | 'dismiss') {
  const t = list.find((x) => x.id === id);
  if (!t || t.leaving) return;
  clearTimeout(timers.get(id)?.handle);
  timers.delete(id);
  emit(list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
  setTimeout(() => emit(list.filter((x) => x.id !== id)), LEAVE_MS);
  t.onClose?.(reason);
}

function run(id: string) {
  const timer = timers.get(id);
  if (!timer || timer.holds.size || timer.handle) return;
  timer.since = performance.now();
  timer.handle = setTimeout(() => close(id, 'timeout'), timer.left);
}

async function undo(id: string) {
  const t = list.find((x) => x.id === id);
  if (!t?.undo || t.leaving) return;
  close(id, 'undo');
  try {
    await t.undo();
  } catch (e) {
    toast.show({ kind: 'error', message: `Couldn't undo: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export const toast = {
  show(o: ToastOptions): string {
    const id = crypto.randomUUID();
    const duration = o.duration ?? (o.kind === 'error' ? Infinity : o.undo ? 8000 : 5000);
    emit([...list, { ...o, id, ctrlZLive: !!o.undo && o.ctrlZ !== false, leaving: false }]);
    const shown = list.filter((x) => !x.leaving);
    if (shown.length > MAX) close(shown[0].id, 'timeout');
    if (Number.isFinite(duration)) {
      timers.set(id, { left: duration, since: 0, holds: new Set(document.hasFocus() ? [] : ['blur']) });
      run(id);
    }
    return id;
  },
  dismiss: (id: string) => close(id, 'dismiss'),
  /** the toast Ctrl+Z should undo right now, if any (the keymap asks before the tool's history) */
  activeCtrlZ(): { id: string; run(): void } | null {
    const t = list.findLast((x) => !x.leaving && x.ctrlZLive);
    return t ? { id: t.id, run: () => void undo(t.id) } : null;
  },
  /** a tool committed: Ctrl+Z belongs to the tool again; toasts keep their Undo button */
  noteCommit() {
    if (list.some((x) => x.ctrlZLive)) emit(list.map((x) => ({ ...x, ctrlZLive: false })));
  },
};

export const toastStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  get: () => list,
  undo: (id: string) => void undo(id),
  /** stop a toast's clock for a reason ('hover', 'blur'); it runs again once no reason is left */
  hold(id: string | null, reason: string) {
    for (const [tid, t] of timers) {
      if (id !== null && tid !== id) continue;
      if (t.handle) {
        clearTimeout(t.handle);
        t.handle = undefined;
        t.left -= performance.now() - t.since;
      }
      t.holds.add(reason);
    }
  },
  release(id: string | null, reason: string) {
    for (const [tid, t] of timers) {
      if (id !== null && tid !== id) continue;
      t.holds.delete(reason);
      run(tid);
    }
  },
};
