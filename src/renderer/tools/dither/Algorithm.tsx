// Algorithm (spec §3): the curated set by family, each with its strength and, where it applies,
// serpentine and a seed. A grey ramp under the picker shows how it spreads tone with this palette,
// through the same engine the image goes through.
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { ALGORITHMS, type Algorithm } from '../../../shared/dither/algorithms.ts';
import { Icon, IconButton, menu, Module, NumberField, Slider, Toggle, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { useWidth } from '../common/useWidth.ts';
import type { Doc } from './actions.ts';
import { fix, LIMIT, NEUTRAL_TONE, used, type DitherDoc } from './doc.ts';
import { run, settingsOf } from './engine.ts';
import { Blocks, ramp } from './Specimen.tsx';
import s from './Algorithm.module.css';
import i from './Inspector.module.css';

const FAMILY: Record<Algorithm['group'], string> = { diffusion: 'Error diffusion', ordered: 'Ordered', noise: 'Noise' };

/** what each one does to an image, in a line */
const ABOUT: Record<string, string> = {
  'floyd-steinberg': 'Error to four neighbours: the classic, fine and even.',
  atkinson: 'Passes on only three quarters of the error: bright, contrasty, the early Mac.',
  jarvis: 'Error over three rows: smooth, a little soft.',
  stucki: 'A sharper three-row spread than Jarvis.',
  burkes: 'Two rows, quick and crisp.',
  sierra: 'Three rows, between Floyd–Steinberg and Jarvis.',
  'sierra-lite': 'The lightest Sierra: two neighbours, grainy.',
  riemersma: 'Diffuses along a Hilbert curve: organic, no directional worms. Clips the deepest shadows and brightest highlights.',
  'dot-diffusion': 'Knuth’s class matrix: diffusion that clumps into dots.',
  bayer2: 'A 2 × 2 threshold screen: five levels, hard checkers.',
  bayer4: 'A 4 × 4 screen: the cross-hatch of 90s games.',
  bayer8: 'An 8 × 8 screen: 65 levels, a fine even weave. This is Knoll’s pattern dithering, clean on any palette.',
  'clustered-dot': 'Dots grow from a centre, like a print halftone.',
  line: 'A 45° line screen: bars that thicken with the tone.',
  'blue-noise': 'A void-and-cluster screen: grain with no pattern, and no crawl in motion.',
  threshold: 'No dither: each pixel takes its nearest colour, flat bands.',
  random: 'Seeded white noise: grainy, as film is.',
  ign: 'Interleaved gradient noise: an even grain that stays put in motion.',
};

function menuOf(current: string, pick: (a: Algorithm) => void): MenuItem[] {
  return (Object.keys(FAMILY) as Algorithm['group'][]).flatMap((g) => [
    { header: FAMILY[g] },
    ...ALGORITHMS.filter((a) => a.group === g).map((a) => ({ label: a.label, checked: a.id === current, onSelect: () => a.id !== current && pick(a) })),
  ]);
}

const RAMP_H = 10;

/** the algorithm on a black-to-white ramp, 3 px a block, at the width of the module */
function RampSpecimen({ d }: { d: DitherDoc }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const w = Math.max(16, Math.floor(width / 3));
  const colours = used(d);
  const img = useMemo(() => ramp(w, RAMP_H), [w]);
  const indices = useMemo(
    () => (colours.length >= 2 ? run(img, w, RAMP_H, settingsOf({ ...d, tone: NEUTRAL_TONE }, colours)) : null),
    [img, d.algorithm, d.strength, d.serpentine, d.seed, d.palette],
  );
  return (
    <div ref={ref} className={s.ramp}>
      <Blocks indices={indices} w={w} h={RAMP_H} colours={colours} />
    </div>
  );
}

export function AlgorithmModule({ doc, d }: { doc: Doc; d: DitherDoc }) {
  const a = ALGORITHMS.find((x) => x.id === d.algorithm) ?? ALGORITHMS[0];
  const strength = useDocNumber(doc, { label: 'Change the strength', key: 'strength', get: (x) => Math.round(x.strength * 100), set: (x, v) => fix({ ...x, strength: v / 100 }) });
  const seed = useDocNumber(doc, { label: 'Change the seed', key: 'seed', get: (x) => x.seed, set: (x, v) => fix({ ...x, seed: v }) });
  const button = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOpen(true);
    menu.open(r, menuOf(a.id, (x) => doc.transact(`Dither with ${x.label}`, (y) => ({ ...y, algorithm: x.id }))), {
      width: r.width,
      owner: e.currentTarget,
      role: 'listbox',
      onClose: () => setOpen(false),
      initial: ALGORITHMS.indexOf(a) + (Object.keys(FAMILY) as Algorithm['group'][]).indexOf(a.group) + 1,
    });
  };
  const reseed = () => doc.transact('New seed', (x) => ({ ...x, seed: (x.seed * 7919 + 13) % (LIMIT.seed[1] + 1) }));
  return (
    <Module title="Algorithm" readout={FAMILY[a.group]}>
      <div className={i.stack}>
        <div className={i.group}>
          <button
            ref={button}
            type="button"
            className={s.pick}
            data-state={isOpen ? 'open' : undefined}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={`Algorithm: ${a.label}`}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              button.current?.click();
            }}
          >
            <span className="lbl">Algorithm</span>
            <span className={s.value}>{a.label}</span>
            <Icon name="unfold_more" size={16} />
          </button>
          <RampSpecimen d={d} />
          <p className={i.note}>{ABOUT[a.id] ?? ''}</p>
        </div>
        <div className={i.group}>
          <Slider label="Strength" min={0} max={100} step={1} unit="%" disabled={!a.strength} {...strength} />
          <div className={i.row}>
            <Toggle label="Serpentine" checked={d.serpentine && a.serpentine} disabled={!a.serpentine} onChange={(on) => doc.transact(on ? 'Serpentine rows' : 'Rows left to right', (x) => ({ ...x, serpentine: on }))} />
            <span className={i.grow} />
            <NumberField label="Seed" min={LIMIT.seed[0]} max={LIMIT.seed[1]} width={112} disabled={!a.seed} {...seed} />
            <IconButton icon="casino" label="New seed" size="sm" disabled={!a.seed} onClick={reseed} />
          </div>
        </div>
      </div>
    </Module>
  );
}
