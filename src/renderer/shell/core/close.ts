import { errorText } from './errors.ts';
import { ipc, log } from './ipc.ts';
import { trashPending } from './library.ts';
import { flushViews } from './persist.ts';
import { allRuntimes, endGesture, idle } from './runtime.ts';
import { getState } from './store.ts';

// Quit (spec §4): main holds `close` and asks; the renderer finishes every write, trashes deletes
// still waiting on their Undo toast (spec §6.3), and says whether an export or import is running.
// Main waits up to 3s and asks Luap only when busy.

export function installCloseHandshake(): void {
  ipc.on('app.closeRequest', () => void reply());
}

async function reply(): Promise<void> {
  let busy = getState().busy > 0;
  try {
    allRuntimes().forEach(endGesture);
    flushViews();
    await Promise.all(allRuntimes().map(idle));
    busy = getState().busy > 0;
    // busy: main asks "Quit anyway?", and Keep running must find the deletes still undoable. So they
    // are trashed only on a quit that is certain; after Quit anyway their files stay where they were.
    if (!busy) await trashPending();
  } catch (e) {
    log('error', 'Close: flushing failed', errorText(e));
  }
  await ipc.invoke('app.closeReply', busy).catch(() => {});
}
