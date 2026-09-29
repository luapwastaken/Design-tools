import { errorText } from './errors.ts';
import { ipc, log } from './ipc.ts';
import { pendingTrashIds } from './library.ts';
import { flushViews } from './persist.ts';
import { allRuntimes, endGesture, idle } from './runtime.ts';
import { getState } from './store.ts';

// Quit (spec §4): main holds `close` and asks; the renderer finishes every write, then says whether
// an export or import is running and which deletes still wait on their Undo toast (spec §6.3).
// Main waits up to 3s, asks Luap only when busy, and trashes those deletes only once the quit is
// certain, so "Keep running" finds them still undoable.

const savers = new Set<() => Promise<void>>();

export function beforeClose(fn: () => Promise<void>): () => void {
  savers.add(fn);
  return () => void savers.delete(fn);
}

export function installCloseHandshake(): void {
  ipc.on('app.closeRequest', () => void reply());
}

/** a part of the quit slower than this is logged, so a quit that runs past main's wait says where */
const SLOW_MS = 500;

async function timed<T>(what: string, work: Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await work;
  const ms = performance.now() - t0;
  if (ms > SLOW_MS) log('warn', `Close: ${what} took ${Math.round(ms)}ms`);
  return out;
}

async function reply(): Promise<void> {
  try {
    allRuntimes().forEach(endGesture);
    // before the views flush: a saver may record what it saved in its tool's view
    await timed("the tools' own saves",Promise.all([...savers].map((f) => f().catch((e) => log('error', 'Close: a save failed', errorText(e))))));
    flushViews();
    await Promise.all(allRuntimes().map((r) => timed(`${r.def.label}'s queued writes`, idle(r))));
  } catch (e) {
    log('error', 'Close: flushing failed', errorText(e));
  }
  await ipc.invoke('app.closeReply', getState().busy > 0, pendingTrashIds()).catch(() => {});
}
