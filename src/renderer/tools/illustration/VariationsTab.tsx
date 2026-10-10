// Variations tab: six whole palettes at once, each the ramps on lit balls under its light. A click (or its
// number) opens one large above the grid, every ramp on a 120 px ball with its step codes; Use this palette
// writes it into the palette as one step. What the grid shows and what its keys do is in variations.ts and
// variation-actions.ts; this is the picture of it.
import { useEffect, useRef } from 'react';
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, Kbd, Segmented } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import type { IllustrationDoc } from './doc.ts';
import { LIT_VIEW, LitCanvas } from './Light.tsx';
import { adoptCell, backToAll, closeCell, moreLikeThis, newSet, setMode, showCell, stepCell } from './variation-actions.ts';
import { ballName, cellRamps, cellsOf, fitsPicture, inUse, lightName, lockedIn, lookFor, openCell, pictureOf, type Cell } from './variations.ts';
import type { IllustrationView } from './view-state.ts';
import s from './Variations.module.css';

const HEX = (o: Oklch) => toHex(o).toUpperCase();
const SMALL = 28;
const BIG = 120;

const MODES = [
  { value: 'colours' as const, label: 'Vary the colours' },
  { value: 'light' as const, label: 'Vary the light' },
];

/** the line under the bar: what the grid is, or why it is what it is */
function statusOf(d: IllustrationDoc, v: IllustrationView): string {
  const colours = v.varMode === 'colours';
  if (colours && lockedIn(d, v).length >= d.ramps.length) return 'Every ramp is locked, so all six are the same. Unlock a ramp to see variations.';
  if (v.varPath.length) {
    const times = v.varPath.length === 1 ? 'once' : `${v.varPath.length} times`;
    return `Narrowed ${times}. Cell 1 is the palette you narrowed from; the other five are close to it. Open one and press M to narrow further.`;
  }
  if (!colours) return 'The same colours under five lights and one in between. Space makes a new in-between light.';
  const picked = pictureOf(v).length;
  if (picked && picked !== d.ramps.length) return `${picked} ${picked === 1 ? 'thing is' : 'things are'} ticked in What's in the picture, and the palette has ${d.ramps.length} ${d.ramps.length === 1 ? 'ramp' : 'ramps'}. Press Make ramps so they match.`;
  if (picked) return "Six versions of this picture: one ramp for each thing ticked, varied within it. Locked ramps are the same in each.";
  return 'Six whole palettes under this light. Click one or press 1 to 6 to see it large. Locked ramps are the same in each.';
}

export function VariationsTab({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const cells = cellsOf(d, v);
  const open = openCell(cells, v);
  const region = useRef<HTMLDivElement>(null);
  const was = useRef(0);
  const wasPath = useRef(0);
  // an opened cell takes the focus, so its keys have a home and a clicked cell is not clicked again by Enter;
  // a closed one hands it back to its cell
  useEffect(() => {
    if (open) {
      region.current?.focus({ preventScroll: true });
      region.current?.scrollIntoView({ block: 'nearest' });
    } else if (was.current && (!document.activeElement || document.activeElement === document.body || region.current?.contains(document.activeElement))) {
      // after More like this the grid is new and cell 1 is the palette narrowed from, so the focus goes there
      document.querySelector<HTMLElement>(`[data-cell="${v.varPath.length !== wasPath.current ? 1 : was.current}"]`)?.focus();
    }
    was.current = open ? open.n : 0;
    wasPath.current = v.varPath.length;
  }, [open?.n]);
  return (
    <>
      <div className={s.bar}>
        <Segmented options={MODES} value={v.varMode} onChange={setMode} fit />
        <span className={s.acts}>
          <span className={s.seed}>Seed {v.varSeed}</span>
          {v.varPath.length > 0 && <Button onClick={backToAll}>Back to all</Button>}
          <Button variant="primary" onClick={newSet} shortcut="Space">
            New set
            <Kbd>Space</Kbd>
          </Button>
        </span>
      </div>
      <p className={s.status}>{statusOf(d, v)}</p>
      {open && (
        <div ref={region} tabIndex={-1} role="region" aria-label={`Variation ${open.n} larger`} data-variations-large className={s.large}>
          <Large doc={doc} d={d} v={v} cell={open} count={cells.length} />
        </div>
      )}
      <div className={s.grid}>
        {cells.map((c) => (
          <CellView key={c.n} d={d} cell={c} on={open?.n === c.n} now={inUse(d, v, c)} parent={v.varPath.length > 0 && c.n === 1} />
        ))}
      </div>
    </>
  );
}

/** the mark on a locked ramp */
const Lock = () => (
  <span className={s.lock} role="img" aria-label="Locked">
    <Icon name="lock" size={14} fill />
  </span>
);

/** a cell's step strip: the steps lightest first, a dot on the base */
function Steps({ ramp }: { ramp: { steps: { step: number; oklch: Oklch }[] } }) {
  return (
    <span className={s.steps} data-steps data-colour>
      {ramp.steps.map((st) => (
        <i key={st.step} style={{ background: cssColor(st.oklch) }}>
          {st.step === 0 && <b className={s.dot} />}
        </i>
      ))}
    </span>
  );
}

function CellView({ d, cell, on, now, parent }: { d: IllustrationDoc; cell: Cell; on: boolean; now: boolean; parent: boolean }) {
  const ramps = cellRamps(d, cell);
  return (
    <button type="button" data-cell={cell.n} aria-pressed={on} className={cx(s.cell, on && s.on)} aria-label={`Show variation ${cell.n} larger, ${cell.label}`} onClick={() => showCell(cell.n)}>
      <span className={s.chead}>
        <Kbd>{cell.n}</Kbd>
        <b>{cell.label}</b>
        <span className={s.note}>{now ? 'in use' : parent ? 'narrowed from' : ''}</span>
      </span>
      <span className={s.band} data-colour aria-hidden="true">
        <i style={{ background: cssColor(cell.light.light) }} />
        <i style={{ background: cssColor(cell.light.shadow) }} />
      </span>
      <span className={s.rows}>
        {ramps.map((r, i) => (
          <span key={i} className={s.row} data-ramp>
            <LitCanvas shape="sphere" size={SMALL} look={lookFor(r, cell.light)} azimuth={LIT_VIEW.azimuth} elevation={LIT_VIEW.elevation} label={`${r.name} on a ball`} className={s.ball} />
            <Steps ramp={r} />
            {cell.bases[i]?.locked && <Lock />}
          </span>
        ))}
      </span>
      <span className={s.cdetail}>{cell.detail}</span>
    </button>
  );
}

/** the open cell, large: every ramp on a 120 px lit ball with its step codes, and the light pair with its name */
function Large({ doc, d, v, cell, count }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; cell: Cell; count: number }) {
  const ramps = cellRamps(d, cell);
  const fits = fitsPicture(d, v);
  return (
    <>
      <div className={s.lhead}>
        <h3>
          Variation {cell.n} · {cell.label}
        </h3>
        <div className={s.lacts}>
          <Button variant="primary" disabled={!fits} onClick={() => adoptCell(doc, cell)} shortcut="Enter" tooltip={fits ? undefined : 'Press Make ramps first, so the ramps match what is ticked'}>
            Use this palette
            <Kbd>Enter</Kbd>
          </Button>
          <Button onClick={() => moreLikeThis(d)} shortcut="M" tooltip="Show six palettes close to this one">
            More like this
            <Kbd>M</Kbd>
          </Button>
          <Button icon="arrow_back" onClick={() => stepCell(count, -1)}>
            Previous
          </Button>
          <Button iconEnd="arrow_forward" onClick={() => stepCell(count, 1)}>
            Next
          </Button>
          <Button onClick={closeCell} shortcut="Escape">
            Close
            <Kbd>Esc</Kbd>
          </Button>
        </div>
      </div>
      <p className={s.light} data-light>
        <i data-colour style={{ background: cssColor(cell.light.light) }} />
        <span>Light {HEX(cell.light.light)}</span>
        <i data-colour style={{ background: cssColor(cell.light.shadow) }} />
        <span>Shadow {HEX(cell.light.shadow)}</span>
        <span className={s.name}>{lightName(cell)}</span>
        {inUse(d, v, cell) && <span className={s.name}>in use</span>}
      </p>
      <div className={s.balls}>
        {ramps.map((r, i) => (
          <figure key={i} className={s.fig} data-ramp>
            <LitCanvas shape="sphere" size={BIG} look={lookFor(r, cell.light)} azimuth={LIT_VIEW.azimuth} elevation={LIT_VIEW.elevation} label={`${ballName(cell, r, v)} on a ball`} className={s.big} />
            <figcaption>
              <b>{ballName(cell, r, v)}</b>
              {cell.bases[i]?.locked && <Lock />}
            </figcaption>
            <ul className={s.codes}>
              {r.steps.map((st) => (
                <li key={st.step} className={cx(st.step === 0 && s.base)}>
                  <i data-colour style={{ background: cssColor(st.oklch) }} />
                  <span>{HEX(st.oklch)}</span>
                </li>
              ))}
            </ul>
          </figure>
        ))}
      </div>
    </>
  );
}
