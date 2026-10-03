// The other lockups under the stage (spec §2): every one that's on, the edited one ringed, one click
// to edit another. A missing part waits at the end as a place to drop it.
import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { select, type Doc } from './actions.ts';
import { KIND_LABEL, shownLockups, type LockupKind, type LogoDoc } from './doc.ts';
import { LockupImg } from './LockupImg.tsx';
import { PartSlot } from './PartDrop.tsx';
import { surroundOf } from './surround.ts';
import type { LogoView } from './view-state.ts';
import s from './Strip.module.css';

/** one Tab stop; the arrows move and choose (brief §6) */
function roam(e: KeyboardEvent<HTMLDivElement>, kinds: LockupKind[], at: number) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step || !kinds.length) return;
  e.preventDefault();
  e.stopPropagation(); // the tool's own arrow shortcuts would step twice
  const next = (at + step + kinds.length) % kinds.length;
  select(kinds[next]);
  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}

export function Strip({ doc, d, v, edited }: { doc: Doc; d: LogoDoc; v: LogoView; edited: LockupKind }) {
  const on = shownLockups(d);
  const kinds = on.map((l) => l.kind);
  const ground = surroundOf(v.surround, d);
  const missing = !d.icon ? 'icon' : !d.wordmark ? 'wordmark' : null;
  return (
    <div className={s.strip}>
      <div className={s.cards} role="radiogroup" aria-label="Lockup to edit" onKeyDown={(e) => roam(e, kinds, kinds.indexOf(edited))}>
        {on.map((l) => (
          <button key={l.kind} type="button" role="radio" aria-checked={l.kind === edited} tabIndex={l.kind === edited ? 0 : -1} className={cx(s.card, l.kind === edited && s.on)} onClick={() => select(l.kind)}>
            <span className={s.mat} style={{ background: ground }}>
              <LockupImg d={d} lockup={l} version={v.version} height={96} className={s.img} />
            </span>
            <Tooltip content={KIND_LABEL[l.kind]} overflowOnly>
              <span className={cx('lbl', s.name)}>{KIND_LABEL[l.kind]}</span>
            </Tooltip>
          </button>
        ))}
      </div>
      {missing && <PartSlot doc={doc} role={missing} className={s.slot} />}
    </div>
  );
}
