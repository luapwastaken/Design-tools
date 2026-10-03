import { useHeld } from '../common/held.ts';
import { status } from './view-state.ts';

/** `3 LAYERS · RENDER 12 MS` (plan unit V), `2 OF 3 ON` when some are hidden, or what it's doing */
export function StatusSlot() {
  const st = status.use();
  // the last time stays up through a drag's quick renders
  const slow = useHeld(!!st?.busy);
  if (!st) return null;
  if (st.error) return <span>No render</span>;
  const layers = st.on === st.layers ? (
    <>
      <b>{st.layers}</b> {st.layers === 1 ? 'layer' : 'layers'}
    </>
  ) : (
    <>
      <b>{st.on}</b> of <b>{st.layers}</b> layers on
    </>
  );
  return (
    <span>
      {layers} · {st.busy && (slow || !st.ms) ? 'rendering…' : <>render <b>{st.ms < 10 ? st.ms.toFixed(1) : Math.round(st.ms)}</b> ms</>}
    </span>
  );
}
