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

export function installCloseHandshake(): void {
  ipc.on('app.closeRequest', () => void reply());
}

async function reply(): Promise<void> {
  try {
    allRuntimes().forEach(endGesture);
    flushViews();
    await Promise.all(allRuntimes().map(idle));
  } catch (e) {
    log('error', 'Close: flushing failed', errorText(e));
  }
  await ipc.invoke('app.closeReply', getState().busy > 0, pendingTrashIds()).catch(() => {});
}
