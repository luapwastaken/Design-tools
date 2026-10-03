import { useHeld } from '../common/held.ts';
import { status } from './view-state.ts';

/** `12,859 DOTS · SCREEN 38 MS` (plan unit V), `≈` when counted from the plates, `FM AT 300 DPI · …` for a stochastic screen, or what it's doing */
export function StatusSlot() {
  const st = status.use();
  // the last time stays up through a drag's quick renders
  const slow = useHeld(!!st?.busy);
  if (!st) return null;
  if (st.error) return <span>No screen</span>;
  if (st.busy && (slow || !st.ms)) return <span>Screening…</span>;
  return (
    <span>
      {st.fm ? (
        <>
          FM at <b>{st.fm}</b> dpi
        </>
      ) : (
        <>
          {st.about && '≈ '}
          <b>{st.dots.toLocaleString('en')}</b> {st.dots === 1 ? 'dot' : 'dots'}
        </>
      )}{' '}
      · screen <b>{Math.round(st.ms)}</b> ms
    </span>
  );
}
