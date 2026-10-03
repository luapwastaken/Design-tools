// Tone (spec §3): levels, gamma and contrast before screening, over the image's histogram with the
// resulting curve drawn on it, so a change reads as a shape before it reads as dots.
import { useMemo } from 'react';
import { toneAt } from '../../../shared/halftone/tone.ts';
import { IconButton, Module, Slider, useDocNumber } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { emptyDoc, type HalftoneDoc } from './doc.ts';
import s from './Tone.module.css';
import i from './Inspector.module.css';

const W = 256;
const H = 64;

type Key = keyof HalftoneDoc['tone'];

function Histogram({ hist, tone }: { hist: Uint32Array | null; tone: HalftoneDoc['tone'] }) {
  const bars = useMemo(() => {
    if (!hist) return '';
    // the tallest bins clip, so one flat background doesn't flatten the rest (as Photoshop does)
    const sorted = [...hist].sort((a, b) => a - b);
    const top = Math.max(1, sorted[Math.floor(sorted.length * 0.98)] * 1.15);
    return Array.from(hist, (v, x) => `M${x} ${H}v${-Math.min(H, (v / top) * H).toFixed(1)}`).join('');
  }, [hist]);
  const curve = useMemo(() => Array.from({ length: 65 }, (_, k) => `${(k / 64) * W},${(H - toneAt(tone, k / 64) * H).toFixed(2)}`).join(' '), [tone]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.hist} aria-hidden="true">
      <path d={bars} className={s.bars} />
      <line x1={0} y1={H} x2={W} y2={0} className={s.ident} />
      <polyline points={curve} className={s.curve} />
      <line x1={tone.black * W} y1={0} x2={tone.black * W} y2={H} className={s.mark} />
      <line x1={tone.white * W} y1={0} x2={tone.white * W} y2={H} className={s.mark} />
    </svg>
  );
}

export function ToneModule({ doc, d, hist }: { doc: Doc; d: HalftoneDoc; hist: Uint32Array | null }) {
  const num = (key: Key, label: string, k: number, set?: (t: HalftoneDoc['tone'], v: number) => HalftoneDoc['tone']) =>
    useDocNumber(doc, { label, key: `tone.${key}`, get: (x) => Math.round(x.tone[key] * k * 1000) / 1000, set: (x, v) => ({ ...x, tone: set ? set(x.tone, v / k) : { ...x.tone, [key]: v / k } }) });
  // the points never cross: moving one past the other takes the other along
  const black = num('black', 'Change the black point', 100, (t, v) => ({ ...t, black: v, white: Math.max(t.white, v + 0.01) }));
  const white = num('white', 'Change the white point', 100, (t, v) => ({ ...t, white: v, black: Math.min(t.black, v - 0.01) }));
  const gamma = num('gamma', 'Change the gamma', 1);
  const contrast = num('contrast', 'Change the contrast', 100);
  const t = d.tone;
  const plain = t.black === 0 && t.white === 1 && t.gamma === 1 && t.contrast === 0;
  return (
    <Module title="Tone" sub="Before screening" actions={<IconButton icon="restart_alt" label="Reset the tone" size="sm" disabled={plain} onClick={() => doc.transact('Reset the tone', (x) => ({ ...x, tone: emptyDoc().tone }))} />}>
      <div className={i.stack}>
        <Histogram hist={hist} tone={t} />
        <div className={i.group}>
          <Slider label="Black point" min={0} max={99} step={0.5} unit="%" {...black} />
          <Slider label="White point" min={1} max={100} step={0.5} unit="%" {...white} />
          <Slider label="Gamma" min={0.2} max={5} step={0.01} {...gamma} />
          <Slider label="Contrast" min={-100} max={100} step={1} unit="%" origin={0} {...contrast} />
        </div>
        <p className={i.note}>Black and white points print as solid ink and bare paper; gamma above 1 opens the midtones.</p>
      </div>
    </Module>
  );
}
