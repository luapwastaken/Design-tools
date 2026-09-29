// The sheet (spec §2, §5 q2): every lockup that's on × every version that's on, like a brand guide
// page. A tile opens that lockup in that version in the edit view. The grid is one Tab stop; the
// arrows move through it (brief §6).
import { useState, type KeyboardEvent } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { clearspaceRect } from '../../../shared/logo/layout.ts';
import { cx } from '../../ui/cx.ts';
import { KIND_LABEL, shownLockups, shownVersions, twoParts, VERSION_LABEL, type LogoDoc } from './doc.ts';
import { LockupImg } from './LockupImg.tsx';
import { surroundOf } from './surround.ts';
import { patchView, type LogoView } from './view-state.ts';
import s from './Sheet.module.css';

const STEP: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

export function Sheet({ d, v }: { d: LogoDoc; v: LogoView }) {
  const [at, setAt] = useState<[number, number]>([0, 0]);
  // each row's tiles take its lockup's shape with the clearspace, within the heights the CSS allows
  const aspect = (l: Parameters<typeof clearspaceRect>[1]) => {
    const r = clearspaceRect(d, l);
    return `${r.w} / ${r.h}`;
  };
  const lockups = shownLockups(d);
  const versions = shownVersions(d);
  const ground = surroundOf(v.surround, d);
  // a knockout brings its field; the tile is that field to its edges, not the surround round a card of it
  const field = cssColor(d.colour);
  if (!lockups.length || !versions.length) {
    return <p className={s.none}>{!lockups.length ? 'Every lockup is off. Turn one on in Lockups.' : 'Every version is off. Turn one on in Versions.'}</p>;
  }
  const [row, col] = [clamp(at[0], lockups.length - 1), clamp(at[1], versions.length - 1)];
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = STEP[e.key];
    if (!by) return;
    e.preventDefault();
    e.stopPropagation(); // the tool's own arrows step the edited lockup
    const next: [number, number] = [clamp(row + by[0], lockups.length - 1), clamp(col + by[1], versions.length - 1)];
    setAt(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-at="${next.join(' ')}"]`)?.focus();
  };
  return (
    <div className={s.sheet}>
      <div className={s.grid} role="group" aria-label="Every lockup in every version" onKeyDown={move} style={{ gridTemplateColumns: `repeat(${versions.length}, minmax(84px, 1fr))` }}>
        {versions.map((x) => (
          <span key={x} className={cx('lbl', s.head)}>
            {VERSION_LABEL[x]}
          </span>
        ))}
        {lockups.map((l, i) => (
          <div key={l.kind} className={s.row}>
            <div className={s.side}>
              <b className={s.kind}>{KIND_LABEL[l.kind]}</b>
              {twoParts(l.kind) && (
                <span className="lbl">
                  Ratio {l.ratio.toFixed(2)} · gap {l.gap.toFixed(2)}
                </span>
              )}
            </div>
            {versions.map((x, j) => (
              <button key={x} type="button" data-at={`${i} ${j}`} tabIndex={i === row && j === col ? 0 : -1} className={s.tile} aria-label={`Edit ${KIND_LABEL[l.kind]} in ${VERSION_LABEL[x]}`} onClick={() => patchView({ mode: 'edit', lockup: l.kind, version: x })}>
                <span className={s.mat} style={{ background: x === 'knockout' ? field : ground, aspectRatio: aspect(l) }}>
                  <LockupImg d={d} lockup={l} version={x} padding="clearspace" height={240} className={s.img} />
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
