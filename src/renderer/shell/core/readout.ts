import type { DocState } from '../../../shared/doc-api.ts';
import type { ToolId } from '../../../shared/types.ts';
import type { Readout } from '../shell-api.ts';

// The title-bar document readout (spec §7.3, §7.5). Pure, so it is unit tested
// (test/shell-readout.test.ts); core/index.ts binds the actions.

export type ReadoutAction = 'take-back' | 'reload' | 'keep-copy' | 'retry';
export type ReadoutText = Omit<Readout, 'actions'> & { actions: ReadoutAction[] };

export const ACTION_LABELS: Record<ReadoutAction, string> = {
  'take-back': 'Take back',
  reload: 'Reload from disk',
  'keep-copy': 'Keep mine as a copy',
  retry: 'Try again',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const two = (n: number) => String(n).padStart(2, '0');

/** 14:32 today, else 27 SEP (local time) */
export function when(at: number, now: number): string {
  const d = new Date(at);
  return d.toDateString() === new Date(now).toDateString() ? `${two(d.getHours())}:${two(d.getMinutes())}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const place = (collection: string) => (collection ? collection.toUpperCase() : 'LIBRARY ROOT');

export function readoutOf(state: DocState | undefined, toolLabel: (id: ToolId) => string, now = Date.now()): ReadoutText {
  const r = (text: string, tone: Readout['tone'] = 'normal', actions: ReadoutAction[] = []): ReadoutText => ({ text, tone, actions });
  switch (state?.t) {
    case undefined:
      return r('');
    case 'new':
      return r('NEW');
    case 'saved':
      return r(`SAVED ${when(state.at, now)} · ${place(state.collection)}`);
    case 'workspace':
      return r('WORKSPACE');
    case 'owned-elsewhere':
      return r(`OPEN IN ${toolLabel(state.by).toUpperCase()}`, 'warn', ['take-back']);
    case 'locked':
      return r(`LOCKED · ${place(state.collection)}`);
    case 'missing':
      return r('NOT IN LIBRARY', 'warn');
    case 'changed-outside':
      return r('CHANGED ON DISK', 'warn', ['reload', 'keep-copy']);
    case 'write-failed':
      return r('NOT SAVED', 'danger', ['retry']);
  }
}
