// Pixel size (spec §3): the exact block size in the exported file, 1 to 32 px, and how the image is
// reduced to one pixel a block. The working size follows from it, so a size of 8 really is 8.
import { Module, NumberField, Segmented, useDocNumber } from '../../ui/index.ts';
import { fmtPx } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { fix, LIMIT, scaleOf, workProblem, workSize, type DitherDoc } from './doc.ts';
import { useView } from './view-state.ts';
import s from './Inspector.module.css';

const PICKS = [1, 2, 4, 8].map((n) => ({ value: `${n}`, label: `${n}`, tip: `Blocks of ${n} px` }));
const RESAMPLES = [
  { value: 'area' as const, label: 'Area average', tip: 'Each block is the average of the pixels it covers: smooth tones' },
  { value: 'nearest' as const, label: 'Nearest', tip: 'Each block takes the one pixel at its centre: hard edges, fine lines may drop out' },
];

export function PixelModule({ doc, d }: { doc: Doc; d: DitherDoc }) {
  const pixel = useDocNumber(doc, { label: 'Change the pixel size', key: 'pixel', get: (x) => x.pixel, set: (x, v) => fix({ ...x, pixel: v }) });
  const { w, h } = workSize(d);
  const why = workProblem(d);
  // the block the files get: the export's scale can make it bigger, or 1 px
  const { times } = useView();
  const block = scaleOf(d, { times });
  const size = d.source ? `: ${fmtPx(w * block, h * block)}` : ', whatever the zoom';
  const setPixel = (n: number) => doc.transact(`Pixel size ${n}`, (x) => ({ ...x, pixel: n }));
  return (
    <Module title="Pixel size" readout={d.source ? `${w.toLocaleString('en')} × ${h.toLocaleString('en')} blocks` : undefined}>
      <div className={s.stack}>
        <div className={s.row}>
          <Segmented mono fit options={PICKS} value={`${d.pixel}`} onChange={(n) => setPixel(Number(n))} />
          <span className={s.grow} />
          <NumberField label="Size" min={LIMIT.pixel[0]} max={LIMIT.pixel[1]} unit="px" width={112} {...pixel} />
        </div>
        <Segmented label="Resample" options={RESAMPLES} value={d.resample} disabled={d.pixel === 1} onChange={(resample) => doc.transact(resample === 'area' ? 'Average each block' : 'Sample each block at its centre', (x) => ({ ...x, resample }))} />
        {why ? (
          <p className={s.warn} role="status">
            {why}
          </p>
        ) : (
          <p className={s.note}>
            {block === d.pixel
              ? `Each block is ${d.pixel} px in the files${size}.`
              : `Each block is ${d.pixel} px at 100%, and ${block} px in the files (Export ${times ? `scale ×${times}` : 'at 1 px a block'})${size}.`}
            {d.pixel === 1 ? ' At 1 px the image is dithered pixel for pixel.' : ''}
          </p>
        )}
      </div>
    </Module>
  );
}
