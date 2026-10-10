// Variations tab: six whole palettes at once, each a small Preview in use page with its seven colours and
// whether its pairs pass. A click (or its number) opens one large above the grid, with the app's own
// Preview in use page; Use this palette writes it into the palette as one step. What the grid shows and
// what its keys do is in variations.ts; this is the picture of it.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import { pairsOf, type DesignCell } from '../../../shared/palette/variations.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Kbd, Toggle } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { scene } from './context-slots.ts';
import type { DesignDoc, DesignView } from './doc.ts';
import { InContext } from './InContext.tsx';
import { adoptCell, backToAll, closeCell, moreLikeThis, newSet, showCell, stepCell } from './variation-actions.ts';
import { cellSwatches, cellsOf, inUse, openCell } from './variations.ts';
import { patchView } from './view-state.ts';
import s from './Variations.module.css';

const HEX = (o: Oklch) => toHex(o).toUpperCase();

/** a changed Let these change box makes a new grid, which no open cell or narrowing belongs to */
const vary = (patch: Partial<DesignView>) => patchView({ ...patch, varPath: [], varOpen: 0 });

/** the line under the bar: what the grid is, or why it is what it is */
function statusOf(v: DesignView, cells: DesignCell[], locks: number): string {
  if (locks >= ROLES.length) return 'Everything is locked, so all six are the same. Unlock a colour to see variations.';
  if (v.varPath.length) {
    const times = v.varPath.length === 1 ? 'once' : `${v.varPath.length} times`;
    return `Narrowed ${times}. Cell 1 is the palette you narrowed from; the other ${cells.length - 1} are close to it. Press M on one to narrow further.`;
  }
  if (!v.varStyle && !v.varAccent && !v.varGround) return 'Only the hues change now. Tick a box to vary more.';
  return 'Six whole palettes. Click one or press 1 to 6 to see it large. Locked colours are the same in each.';
}

export function VariationsTab({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const cells = cellsOf(d, v);
  const open = openCell(cells, v);
  const locks = d.swatches.filter((w) => w.role && v.locked.includes(w.id)).length;
  const region = useRef<HTMLDivElement>(null);
  const was = useRef(0);
  // an opened cell takes the focus, so its keys have a home and a clicked cell is not clicked again by Enter;
  // a closed one hands it back to its cell
  useEffect(() => {
    if (open) {
      region.current?.focus({ preventScroll: true });
      region.current?.scrollIntoView({ block: 'nearest' });
    } else if (was.current && (!document.activeElement || document.activeElement === document.body || region.current?.contains(document.activeElement))) {
      document.querySelector<HTMLElement>(`[data-cell="${was.current}"]`)?.focus();
    }
    was.current = open ? open.n : 0;
  }, [open?.n]);
  return (
    <>
      <div className={s.bar}>
        <div className={s.group} role="group" aria-label="Let these change">
          <span className={s.cap}>Let these change</span>
          <Toggle quiet label="Style" checked={v.varStyle} onChange={(varStyle) => vary({ varStyle })} />
          <Toggle quiet label="Accent" checked={v.varAccent} onChange={(varAccent) => vary({ varAccent })} />
          <Toggle quiet label="Light or dark page" checked={v.varGround} onChange={(varGround) => vary({ varGround })} />
        </div>
        <span className={s.acts}>
          <span className={s.seed}>Seed {v.varSeed}</span>
          {v.varPath.length > 0 && <Button onClick={backToAll}>Back to all</Button>}
          <Button variant="primary" onClick={newSet} shortcut="Space">
            New set
            <Kbd>Space</Kbd>
          </Button>
        </span>
      </div>
      <p className={s.status}>{statusOf(v, cells, locks)}</p>
      {open && (
        <div ref={region} tabIndex={-1} role="region" aria-label={`Variation ${open.n} larger`} data-variations-large className={s.large}>
          <Large doc={doc} d={d} cell={open} count={cells.length} />
        </div>
      )}
      <div className={s.grid}>
        {cells.map((c) => (
          <Cell key={c.n} cell={c} on={open?.n === c.n} now={inUse(d, c)} parent={v.varPath.length > 0 && c.n === 1} />
        ))}
      </div>
    </>
  );
}

/** "9/9 pairs pass · text 14.6:1", or which pair falls short */
function Pass({ cell }: { cell: DesignCell }) {
  const k = cell.checks;
  return k.passed === k.total ? (
    <span className={s.pass}>{`${k.passed}/${k.total} pairs pass · text ${k.text.toFixed(1)}:1`}</span>
  ) : (
    <span className={cx(s.pass, s.short)}>{`${k.passed}/${k.total} pairs pass · ${k.fails[0]} falls short`}</span>
  );
}

function Cell({ cell, on, now, parent }: { cell: DesignCell; on: boolean; now: boolean; parent: boolean }) {
  const [main, ...rest] = cell.label.split(' · ');
  const [style, accent, changed] = [main, rest[0], rest.slice(1).join(' · ')];
  return (
    <button type="button" data-cell={cell.n} aria-pressed={on} className={cx(s.cell, on && s.on)} aria-label={`Show variation ${cell.n} larger, ${cell.label}`} onClick={() => showCell(cell.n)}>
      <span className={s.chead}>
        <Kbd>{cell.n}</Kbd>
        <b>{accent ? `${style} · ${accent}` : style}</b>
        <span className={s.note}>{now ? 'in use' : parent ? 'narrowed from' : `${cell.ground} page`}</span>
      </span>
      <Mini cell={cell} />
      <span className={s.chips} data-colour>
        {ROLES.map((role) => (
          <span key={role} role="img" aria-label={`${role} ${HEX(cell.roles[role])}`} style={{ background: cssColor(cell.roles[role]) }} />
        ))}
      </span>
      <Pass cell={cell} />
      {changed && <span className={s.cdetail}>{changed}</span>}
    </button>
  );
}

/** Preview in use at thumbnail size: the colours the page picks for the cell's own ground (context-slots), not a flat sample */
function Mini({ cell }: { cell: DesignCell }) {
  const sc = useMemo(() => scene(cellSwatches(cell), cell.ground)!, [cell]);
  const c = (x: { oklch: Oklch }) => cssColor(x.oklch);
  const vars = { '--pg': c(sc.page), '--sf': c(sc.surface), '--tx': c(sc.text), '--mu': c(sc.muted), '--pr': c(sc.primary), '--on-pr': c(sc.onPrimary), '--ac': c(sc.accent), '--hl': c(sc.highlight), '--on-hl': c(sc.onHighlight) } as CSSProperties;
  return (
    <span className={s.pv} data-colour style={vars} aria-hidden="true">
      <span className={s.nav}>
        <i className={s.dot} />
        <i className={s.bar1} />
        <i className={s.bar2} />
        <i className={s.bar3} />
      </span>
      <span className={s.h}>
        Small runs, <mark>printed by hand.</mark>
      </span>
      <span className={s.p}>Riso and letterpress for artists, bands and small brands.</span>
      <span className={s.btns}>
        <span className={s.b1}>Start an order</span>
        <span className={s.b2}>See the inks</span>
      </span>
      <span className={s.card}>
        <span className={s.t}>
          Prints this week
          <em>1,240</em>
        </span>
        <span className={s.bars}>
          {[38, 60, 46, 78, 64].map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </span>
      </span>
    </span>
  );
}

/** the open cell, large: the app's Preview in use page, the seven colours with hex, the nine contrast checks */
function Large({ doc, d, cell, count }: { doc: Doc; d: DesignDoc; cell: DesignCell; count: number }) {
  const pairs = pairsOf(cell.roles);
  return (
    <>
      <div className={s.lhead}>
        <h3>
          Variation {cell.n} · {cell.label}
          <span className={s.note}>{cell.ground} page</span>
        </h3>
        <div className={s.lacts}>
          <Button variant="primary" onClick={() => adoptCell(doc, cell)} shortcut="Enter">
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
      <div className={s.page}>
        <InContext swatches={cellSwatches(cell)} />
      </div>
      <div className={s.lbody}>
        <div>
          <h4 className={s.h4}>The seven colours</h4>
          <div className={s.lsw}>
            {ROLES.map((role) => (
              <div key={role}>
                <i data-colour style={{ background: cssColor(cell.roles[role]) }} />
                <b>{role}</b>
                <span>{HEX(cell.roles[role])}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className={s.h4}>Contrast checks</h4>
          <ul className={s.lchecks}>
            {pairs.map((p) => (
              <li key={p.name}>
                <span className={s.n}>{p.name}</span>
                <span className={s.r}>{`${p.ratio.toFixed(1)}:1 of ${p.need}`}</span>
                <span className={p.pass ? s.ok : s.bad}>{p.pass ? 'Pass' : 'Falls short'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
