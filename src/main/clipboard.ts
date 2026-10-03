// The Export row's Copy (src/shared/clipboard.ts has the formats). A test run (--smoke, --smoke-dir,
// --smoke-quiet) NEVER touches the system clipboard: it writes to memory instead, which the smoke
// checks read back through 'clipboard.peek'. Luap's clipboard is his, and tests run while he works.
import { clipboard, ClipboardItem } from 'electron';
import { copyWith, type Copying, type Entries, type Write } from '../shared/clipboard.ts';
import { errorText, log } from './log.ts';

export type ClipboardService = ReturnType<typeof createClipboard>;

const toItem = (entries: Entries) =>
  new ClipboardItem(Object.fromEntries(Object.entries(entries).map(([type, data]) => [type, typeof data === 'string' ? data : new Blob([data as BlobPart])])));

export function createClipboard({ smoke }: { smoke: boolean }) {
  let held: Record<string, ArrayBuffer> = {};

  // Through a real ClipboardItem, so a format it would refuse fails in the test run too
  const toMemory: Write = async (entries) => {
    const item = toItem(entries);
    const next: Record<string, ArrayBuffer> = {};
    for (const type of item.types) next[type] = await ((await item.getType(type)) as Blob).arrayBuffer();
    held = next;
  };
  const toSystem: Write = (entries) => clipboard.write([toItem(entries)]);
  const write = smoke ? toMemory : toSystem;

  return {
    copy: (what: Copying) => copyWith(write, what, (e) => log('warn', 'The clipboard refused a write', errorText(e))),
    /** what the memory clipboard holds, by format; only a test run has one (the real clipboard is never read) */
    peek(): Record<string, ArrayBuffer> {
      if (!smoke) throw new Error('Only a test run can read the clipboard back.');
      return held;
    },
  };
}
