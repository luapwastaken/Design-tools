import type { DocController } from '../../../shared/doc-api.ts';
import { useSettled } from '../common/settled.ts';
import type { DesignDoc } from './doc.ts';
import { results } from './results.ts';
import { useView } from './view-state.ts';

/** `6 SWATCHES · 2 FAIL` (plan unit V): what the checks call failures */
export function StatusSlot({ doc }: { doc: DocController<DesignDoc> }) {
  const { swatches, ramps } = useSettled(doc);
  const v = useView();
  const n = swatches.length;
  const fails = n ? results(swatches, ramps, v.flagL, v.flagE).problems : 0;
  return (
    <span>
      <b>{n}</b> {n === 1 ? 'swatch' : 'swatches'}
      {fails > 0 && (
        <>
          {' · '}
          <b>{fails}</b> fail
        </>
      )}
    </span>
  );
}
