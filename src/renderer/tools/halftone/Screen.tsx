// Screen (spec §3): the dot shape, the frequency in lines per inch of the page, the smallest dot a
// press holds, and dot gain compensation.
import { type KeyboardEvent, type ReactNode } from 'react';
import { IconButton, Module, Slider, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { Doc } from './actions.ts';
import { emptyDoc, fix, LIMIT, type HalftoneDoc, type Shape } from './doc.ts';
import s from './Screen.module.css';
import i from './Inspector.module.css';

// 2 × 2 cells of each shape at about 40%, drawn in the key's own ink
const g = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {children}
  </svg>
);
const at = [4, 12];
const GLYPH: Record<Shape, ReactNode> = {
  round: g(at.flatMap((x) => at.map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={2.6} />))),
  ellipse: g(at.flatMap((x) => at.map((y) => <ellipse key={`${x}${y}`} cx={x} cy={y} rx={3.4} ry={1.9} transform={`rotate(-45 ${x} ${y})`} />))),
  square: g(at.flatMap((x) => at.map((y) => <rect key={`${x}${y}`} x={x - 2.4} y={y - 2.4} width={4.8} height={4.8} />))),
  diamond: g(at.flatMap((x) => at.map((y) => <rect key={`${x}${y}`} x={x - 2.4} y={y - 2.4} width={4.8} height={4.8} transform={`rotate(45 ${x} ${y})`} />))),
  line: g(at.map((y) => <rect key={y} x={0} y={y - 1.6} width={16} height={3.2} />)),
  cross: g(at.flatMap((x) => at.map((y) => <path key={`${x}${y}`} d={`M${x - 3} ${y - 0.9}h6v1.8h-6zM${x - 0.9} ${y - 3}h1.8v6h-1.8z`} />))),
  stochastic: g([[2, 3], [7, 1], [12, 4], [4, 8], [9, 7], [14, 9], [1, 13], [6, 12], [11, 14], [13, 1]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width={2} height={2} />)),
};

const SHAPES: { value: Shape; label: string; tip: string }[] = [
  { value: 'round', label: 'Round', tip: 'Round dots: the classic screen' },
  { value: 'ellipse', label: 'Ellipse', tip: 'Elliptical dots, which chain smoothly through the midtones' },
  { value: 'square', label: 'Square', tip: 'Square dots' },
  { value: 'diamond', label: 'Diamond', tip: 'Diamond dots' },
  { value: 'line', label: 'Line', tip: 'A line screen: bars that thicken with the tone' },
  { value: 'cross', label: 'Cross', tip: 'Crosses' },
  { value: 'stochastic', label: 'Stochastic (FM)', tip: 'Single printer dots scattered by blue noise: no angles, no rosettes, no SVG' },
];

/** the coverage where each dot first touches its neighbours, for the caption */
const JOINS: Partial<Record<Shape, string>> = { round: 'dots join at 78%', ellipse: 'dots chain from 47%', square: 'squares meet at 100%', diamond: 'corners meet at 50%', line: 'lines merge at 100%' };

function ShapeKeys({ value, onChange }: { value: Shape; onChange(v: Shape): void }) {
  const idx = SHAPES.findIndex((x) => x.value === value);
  // one Tab stop; arrows move and choose (brief §6)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -4, ArrowRight: 1, ArrowDown: 4 }[e.key] ?? 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(SHAPES.length - 1, Math.max(0, idx + step));
    onChange(SHAPES[next].value);
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={s.keys} role="radiogroup" aria-label="Dot shape" onKeyDown={onKey}>
      {SHAPES.map((x, n) => (
        <button key={x.value} type="button" role="radio" aria-checked={n === idx} tabIndex={n === idx ? 0 : -1} className={cx(s.key, n === idx && s.on, x.value === 'stochastic' && s.wide)} onClick={() => onChange(x.value)}>
          {GLYPH[x.value]}
          <span>{x.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ScreenModule({ doc, d }: { doc: Doc; d: HalftoneDoc }) {
  const num = (key: 'lpi' | 'minDot' | 'gain', label: string, k = 1) =>
    useDocNumber(doc, { label, key, get: (x) => Math.round(x.screen[key] * k * 1000) / 1000, set: (x, v) => fix({ ...x, screen: { ...x.screen, [key]: v / k } }) });
  const lpi = num('lpi', 'Change the frequency');
  const minDot = num('minDot', 'Change the smallest dot', 100);
  const gain = num('gain', 'Change the dot gain compensation', 100);
  const fm = d.screen.shape === 'stochastic';
  const cellMm = 25.4 / d.screen.lpi;
  const cellPx = d.size.dpi / d.screen.lpi;
  const join = JOINS[d.screen.shape];
  const reset = () => doc.transact('Reset the screen', (x) => ({ ...x, screen: emptyDoc().screen }));

  return (
    <Module title="Screen" readout={fm ? `FM · ${d.size.dpi} dpi` : `${d.screen.lpi} lpi`} actions={<IconButton icon="restart_alt" label="Reset the screen" size="sm" onClick={reset} />}>
      <div className={i.stack}>
        <ShapeKeys value={d.screen.shape} onChange={(shape) => doc.transact(`Screen with ${SHAPES.find((x) => x.value === shape)!.label.toLowerCase()} dots`, (x) => ({ ...x, screen: { ...x.screen, shape } }))} />
        <div className={i.group}>
          <Slider label="Frequency" min={LIMIT.lpi[0]} max={LIMIT.lpi[1]} step={1} unit="lpi" disabled={fm} {...lpi} />
          <p className={i.cap}>
            {fm ? (
              <>
                Dots of one printer pixel, <b>{(25.4 / d.size.dpi).toFixed(3)} mm</b>, spread by blue noise
              </>
            ) : (
              <>
                Cell <b>{cellMm.toFixed(2)} mm</b> · {cellPx < 10 ? cellPx.toFixed(1) : Math.round(cellPx)} px at {d.size.dpi} dpi{join ? ` · ${join}` : ''}
              </>
            )}
          </p>
          {!fm && cellPx < 4 && <p className={i.warn}>Under 4 printer pixels a cell: at {d.size.dpi} dpi the plates can't draw {d.screen.lpi} lpi dots cleanly. Raise the DPI or lower the frequency.</p>}
        </div>
        <div className={i.group}>
          <Slider label="Min dot" min={0} max={LIMIT.minDot[1] * 100} step={0.5} unit="%" disabled={fm} {...minDot} />
          <Slider label="Dot gain" min={0} max={LIMIT.gain[1] * 100} step={0.5} unit="%" {...gain} />
          <p className={i.note}>{fm ? 'FM dots are all the smallest size, so min dot is for cell shapes.' : 'Gain shrinks each dot so the press brings it back; the view shows the plate.'}</p>
        </div>
      </div>
    </Module>
  );
}
