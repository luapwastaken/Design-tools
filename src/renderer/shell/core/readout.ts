import type { DocState } from '../../../shared/doc-api.ts';
import type { ToolId } from '../../../shared/types.ts';
import type { Readout } from '../shell-api.ts';

// The doc bar's document readout (spec §7.3, §7.5). Pure, so it is unit tested
// (test/shell-readout.test.ts); core/index.ts binds the actions.

export type ReadoutAction = 'take-back' | 'reload' | 'keep-copy' | 'retry';
export type ReadoutText = Omit<Readout, 'actions'> & { actions: ReadoutAction[] };

export const ACTION_LABELS: Record<ReadoutAction, string> = {
  'take-back': 'Take back',
  reload: 'Reload from disk',
  'keep-copy': 'Keep mine as a copy',
  retry: 'Try again',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** 14:32 today, else 27 Sep (local time) */
export function when(at: number, now: number): string {
  const d = new Date(at);
  return d.toDateString() === new Date(now).toDateString() ? `${two(d.getHours())}:${two(d.getMinutes())}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const place = (collection: string) => (collection || 'Library');

export function readoutOf(state: DocState | undefined, toolLabel: (id: ToolId) => string, now = Date.now()): ReadoutText {
  const r = (text: string, tone: Readout['tone'] = 'normal', actions: ReadoutAction[] = []): ReadoutText => ({ text, tone, actions });
  switch (state?.t) {
    case undefined:
      return r('');
    case 'new':
      return r('Not saved yet');
    case 'saved':
      return r(`${place(state.collection)} · saved ${when(state.at, now)}`);
    case 'workspace':
      return r('Workspace');
    case 'owned-elsewhere':
      return r(`Open in ${toolLabel(state.by)}`, 'warn', ['take-back']);
    case 'locked':
      return r(`${place(state.collection)} · locked`);
    case 'missing':
      return r('Not in Library', 'warn');
    case 'changed-outside':
      return r('Changed on disk', 'warn', ['reload', 'keep-copy']);
    case 'write-failed':
      return r('Not saved', 'danger', ['retry']);
  }
}
