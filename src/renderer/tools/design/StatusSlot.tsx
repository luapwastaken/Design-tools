import type { DocController } from '../../../shared/doc-api.ts';
import { useSettled } from '../common/settled.ts';
import type { DesignDoc } from './doc.ts';
import { proposals } from './proposals.ts';
import { results } from './results.ts';
import { useView } from './view-state.ts';

/** `6 SWATCHES · 3 PROPOSALS · 3 TO LOOK AT`: the Check tab's count, as the status bar reads it */
export function StatusSlot({ doc }: { doc: DocController<DesignDoc> }) {
  const { swatches, ramps } = useSettled(doc);
  const v = useView();
  const ghosts = proposals.use()?.items.length ?? 0;
  const n = swatches.length;
  const look = n ? results(swatches, ramps, v.flagL, v.flagE).toLookAt : 0;
  return (
    <span>
      <b>{n}</b> {n === 1 ? 'swatch' : 'swatches'}
      {ghosts > 0 && (
        <>
          {' · '}
          <b>{ghosts}</b> {ghosts === 1 ? 'proposal' : 'proposals'}
        </>
      )}
      {look > 0 && (
        <>
          {' · '}
          <b>{look}</b> to look at
        </>
      )}
    </span>
  );
}
