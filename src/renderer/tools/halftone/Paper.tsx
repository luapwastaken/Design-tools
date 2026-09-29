// Paper (spec §3): the sheet the inks print on, and whether the exports carry it or leave it clear.
import { toHex } from '../../../shared/color/index.ts';
import { ColorField, Module, Toggle, useDocColour } from '../../ui/index.ts';
import { displayName } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { BONE, overlapOf, type HalftoneDoc } from './doc.ts';
import s from './Inspector.module.css';

/** OKLCH lightness under which overprinted inks leave little to see: they can only darken the sheet */
const DARK = 0.45;

export function PaperModule({ doc, d }: { doc: Doc; d: HalftoneDoc }) {
  const paper = useDocColour(doc, { label: 'Change the paper', key: 'paper', get: (x) => x.paper.colour, set: (x, colour) => ({ ...x, paper: { ...x.paper, colour } }) });
  // by hex, as the field shows it: a typed #EFE9DD is still Bone
  const name = toHex(d.paper.colour) === toHex(BONE) ? 'Bone, uncoated' : displayName({ name: '', oklch: d.paper.colour });
  const dark = d.paper.colour[0] < DARK && overlapOf(d) === 'overprint';
  return (
    <Module title="Paper">
      <div className={s.stack}>
        <ColorField {...paper} name={name} />
        {dark && (
          <p className={s.note} role="status">
            Overprinted inks are transparent, so on paper this dark they only darken it: the print comes out nearly black.{d.mode === 'spot' ? ' Knockout prints spot inks as they are, lighter ones too.' : ''}
          </p>
        )}
        <div className={s.group}>
          <Toggle label="In the exports" checked={d.paper.include} onChange={(include) => doc.transact(include ? 'Put the paper in the exports' : 'Leave the paper out of the exports', (x) => ({ ...x, paper: { ...x.paper, include } }))} />
          <p className={s.note}>{d.paper.include ? 'Under the SVG (a preview-only layer) and the PNG; never on the plates.' : 'The SVG and PNG are clear round the dots; the view still shows the paper.'}</p>
        </div>
      </div>
    </Module>
  );
}
