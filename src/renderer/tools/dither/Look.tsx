// Look (spec §5 q2): ten starting points, each a palette and settings, shown as your image in that
// look (a grey ramp until there is one). A look is a start, not a mode: change anything after it.
import { useMemo, type KeyboardEvent } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { Module, SwatchStrip, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { applyLook, type Doc } from './actions.ts';
import type { DitherDoc } from './doc.ts';
import { run, settingsOf } from './engine.ts';
import { isLook, lookOf, LOOKS, presetOf, withLook, type Look } from './looks.ts';
import { Blocks, ramp, useThumbnail } from './Specimen.tsx';
import s from './Look.module.css';

const TW = 30;
const TH = 20;
const RAMP = ramp(TW, TH);

function LookKey({ d, look, img, on, focusable, onPick }: { d: DitherDoc; look: Look; img: Float32Array; on: boolean; focusable: boolean; onPick(): void }) {
  const colours = presetOf(look.preset)!.colours;
  const indices = useMemo(() => run(img, TW, TH, settingsOf(withLook(d, look), colours)), [img, look, d.seed]);
  return (
    <Tooltip content={look.about}>
      <button type="button" role="radio" aria-checked={on} tabIndex={focusable ? 0 : -1} className={cx(s.key, on && s.on)} onClick={onPick}>
        <Blocks indices={indices} w={TW} h={TH} colours={colours} className={s.thumb} />
        <span className={s.text}>
          <span className={s.name}>{look.name}</span>
          <SwatchStrip colors={colours.map(cssColor)} height={6} className={s.strip} />
        </span>
      </button>
    </Tooltip>
  );
}

export function LookModule({ doc, d }: { doc: Doc; d: DitherDoc }) {
  const thumb = useThumbnail(d, TW, TH);
  const img = thumb ?? RAMP;
  const at = LOOKS.findIndex((l) => isLook(d, l));
  const from = lookOf(d.look);
  const readout = at >= 0 ? LOOKS[at].name : from ? `${from.name}, changed` : 'Your own';
  // one Tab stop; arrows move and choose (brief §6)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -2, ArrowRight: 1, ArrowDown: 2 }[e.key] ?? 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(LOOKS.length - 1, Math.max(0, (at < 0 ? 0 : at) + step));
    applyLook(doc, LOOKS[next]);
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <Module title="Look" readout={readout}>
      <div className={s.grid} role="radiogroup" aria-label="Look" onKeyDown={onKey}>
        {LOOKS.map((look, n) => (
          <LookKey key={look.id} d={d} look={look} img={img} on={n === at} focusable={n === (at < 0 ? 0 : at)} onPick={() => n !== at && applyLook(doc, look)} />
        ))}
      </div>
    </Module>
  );
}
