// Output size (spec §3): the page in mm or inches at a print DPI. The screen's frequency counts
// per inch of this page, so the dot count is real (v1 tied it to pixels).
import { Button, IconButton, Module, NumberField, Segmented, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { Doc } from './actions.ts';
import { fix, LIMIT, MM_PER, PAGES, printPx, UNIT_STEP, type HalftoneDoc, type Unit } from './doc.ts';
import s from './Inspector.module.css';

const UNITS: { value: Unit; label: string }[] = [
  { value: 'mm', label: 'mm' },
  { value: 'in', label: 'in' },
];
const FITS = [
  { value: 'contain' as const, label: 'Whole image', tip: 'The whole image on the page; paper shows round it' },
  { value: 'cover' as const, label: 'Fill the page', tip: 'The image fills the page; its overflow is cut off' },
];

/** the side limits in a unit, on its steps */
const range = (unit: Unit): [number, number] => {
  const k = 1 / UNIT_STEP[unit];
  return [Math.ceil((LIMIT.side[0] / MM_PER[unit]) * k) / k, Math.floor((LIMIT.side[1] / MM_PER[unit]) * k) / k];
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

/** the image's own resolution at this size: what the screen has to work from */
export function sourcePpi(d: HalftoneDoc): number | null {
  if (!d.source) return null;
  const across = d.source.w / (d.size.w / 25.4);
  const down = d.source.h / (d.size.h / 25.4);
  // whole, the image spans the page one way and falls short the other: its tighter side sets the scale
  return d.fit === 'contain' ? Math.max(across, down) : Math.min(across, down);
}

export function OutputModule({ doc, d }: { doc: Doc; d: HalftoneDoc }) {
  const unit = d.size.unit;
  const [lo, hi] = range(unit);
  const side = (k: 'w' | 'h', label: string) =>
    useDocNumber(doc, { label, key: `size.${k}`, get: (x) => x.size[k] / MM_PER[x.size.unit], set: (x, v) => fix({ ...x, size: { ...x.size, [k]: v * MM_PER[x.size.unit] } }) });
  const w = side('w', 'Change the page width');
  const h = side('h', 'Change the page height');
  const dpi = useDocNumber(doc, { label: 'Change the DPI', key: 'dpi', get: (x) => x.size.dpi, set: (x, v) => fix({ ...x, size: { ...x.size, dpi: v } }) });

  const portrait = d.size.h >= d.size.w;
  const page = PAGES.find((p) => (near(p.w, d.size.w) && near(p.h, d.size.h)) || (near(p.h, d.size.w) && near(p.w, d.size.h)));
  const setPage = (p: (typeof PAGES)[number]) =>
    doc.transact(`Make the page ${p.label}`, (x) => ({ ...x, size: { ...x.size, w: portrait ? p.w : p.h, h: portrait ? p.h : p.w } }));
  const src = d.source;
  const matches = src && near(d.size.h, (d.size.w * src.h) / src.w);
  const px = printPx(d);
  const ppi = sourcePpi(d);
  const want = 2 * d.screen.lpi;

  return (
    <Module
      title="Output size"
      readout={`${px.w.toLocaleString('en')} × ${px.h.toLocaleString('en')} px`}
      actions={<Segmented mono fit options={UNITS} value={unit} onChange={(u) => doc.transact(`Show sizes in ${u}`, (x) => ({ ...x, size: { ...x.size, unit: u } }))} />}
    >
      <div className={s.stack}>
        <div className={s.picks} role="group" aria-label="Page sizes">
          {PAGES.map((p) => (
            <Button key={p.label} size="xs" variant={page === p ? 'secondary' : 'ghost'} onClick={() => setPage(p)} tooltip={`${p.w} × ${p.h} mm`}>
              {p.label}
            </Button>
          ))}
          <Button size="xs" variant={matches ? 'secondary' : 'ghost'} disabled={!src} onClick={() => src && doc.transact('Shape the page to the image', (x) => fix({ ...x, size: { ...x.size, h: (x.size.w * src.h) / src.w } }))} tooltip="Keep the width and give the page the image's proportions">
            Image
          </Button>
          <span className={s.grow} />
          <IconButton icon={portrait ? 'crop_portrait' : 'crop_landscape'} label={portrait ? 'Portrait: turn to landscape' : 'Landscape: turn to portrait'} size="sm" onClick={() => doc.transact(portrait ? 'Turn the page to landscape' : 'Turn the page to portrait', (x) => ({ ...x, size: { ...x.size, w: x.size.h, h: x.size.w } }))} />
        </div>
        <div className={s.trio}>
          <NumberField label="W" min={lo} max={hi} step={UNIT_STEP[unit]} unit={unit} {...w} />
          <NumberField label="H" min={lo} max={hi} step={UNIT_STEP[unit]} unit={unit} {...h} />
          <NumberField label="DPI" min={LIMIT.dpi[0]} max={LIMIT.dpi[1]} {...dpi} />
        </div>
        <Segmented options={FITS} value={d.fit} onChange={(fit) => doc.transact(fit === 'cover' ? 'Fill the page with the image' : 'Fit the whole image on the page', (x) => ({ ...x, fit }))} />
        {ppi !== null && (
          // advice, not a failure: the export is still right, so no danger colour (brief §4)
          <p className={cx(s.note, ppi < want * 0.75 && s.soft)}>
            The image gives {Math.round(ppi)} ppi here; {d.screen.shape === 'stochastic' ? `FM at ${d.size.dpi} dpi` : `${d.screen.lpi} lpi`} wants about {d.screen.shape === 'stochastic' ? Math.round(d.size.dpi / 2) : Math.round(want)}
            {ppi < want * 0.75 ? ', so detail will be soft.' : '.'}
          </p>
        )}
      </div>
    </Module>
  );
}
