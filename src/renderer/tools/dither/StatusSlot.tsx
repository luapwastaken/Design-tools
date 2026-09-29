import { useHeld } from '../common/held.ts';
import { status } from './view-state.ts';

/** `960 × 540 WORKING · 4 COLOURS · DITHER 38 MS` (plan unit V), or what it's doing */
export function StatusSlot() {
  const st = status.use();
  // the last time stays up through a drag's quick renders
  const slow = useHeld(!!st?.busy);
  if (!st) return null;
  if (st.error) return <span>No dither</span>;
  const busy = st.busy && (slow || !st.ms);
  return (
    <span>
      <b>
        {st.w.toLocaleString('en')} × {st.h.toLocaleString('en')}
      </b>{' '}
      working · <b>{st.colours}</b> {st.colours === 1 ? 'colour' : 'colours'} · {busy ? 'dithering…' : <>dither <b>{Math.round(st.ms)}</b> ms</>}
    </span>
  );
}
