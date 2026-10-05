// The selected layer's settings (plan unit V), drawn inline under its row in the stack (Photoshop's
// adjustments style): its opacity and blend, then the effect's own settings, each a Slider with its
// NumberField, a Toggle, a choice, or a ColorField. The colour effects take their colours from a Library
// palette too (Send to: EFFECT COLOURS lands on the selected layer).
import type { MouseEvent } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { ColorField, InfoTip, InspectorRow, menu, Segmented, Select, Slider, SwatchStrip, Toggle, useDocColour, useDocNumber } from '../../ui/index.ts';
import { paletteMenu, useReadAhead } from '../common/palettes.ts';
import { labelOf, type Doc } from './actions.ts';
import { BLENDS, effectOf, type Param } from './effects/index.ts';
import { perLoop } from './effects/params.ts';
import { mapLayer, RUN_IN, type Layer, type PostFxDoc, type Timeline } from './doc.ts';
import s from './Layer.module.css';

const setParam = (d: PostFxDoc, id: string, key: string, v: Layer['params'][string]) => mapLayer(d, id, (l) => ({ ...l, params: { ...l.params, [key]: v } }));
const paramOf = (d: PostFxDoc, id: string, key: string) => d.stack.find((l) => l.id === id)?.params[key];

function NumberParam({ doc, l, p }: { doc: Doc; l: Layer; p: Extract<Param, { kind: 'number' }> }) {
  const bind = useDocNumber(doc, {
    label: `Change ${labelOf(l)} ${p.label.toLowerCase()}`,
    key: `${l.id}:${p.key}`,
    get: (x) => (paramOf(x, l.id, p.key) as number | undefined) ?? p.def,
    set: (x, v) => setParam(x, l.id, p.key, p.fit(v) as number),
  });
  return <Slider label={p.label} min={p.min} max={p.max} step={p.step} unit={p.unit} origin={p.origin} {...bind} />;
}

function ColourParam({ doc, l, p }: { doc: Doc; l: Layer; p: Extract<Param, { kind: 'colour' }> }) {
  const bind = useDocColour(doc, {
    label: `Change ${labelOf(l)} ${p.label.toLowerCase()}`,
    key: `${l.id}:${p.key}`,
    get: (x) => (paramOf(x, l.id, p.key) as [number, number, number] | undefined) ?? p.def,
    set: (x, v) => setParam(x, l.id, p.key, v),
  });
  return (
    <InspectorRow label={p.label}>
      <ColorField {...bind} className={s.grow} />
    </InspectorRow>
  );
}

function ParamRow({ doc, l, p }: { doc: Doc; l: Layer; p: Param }) {
  const set = (label: string, v: Layer['params'][string]) => doc.transact(label, (x) => setParam(x, l.id, p.key, v));
  if (p.kind === 'number') return <NumberParam doc={doc} l={l} p={p} />;
  if (p.kind === 'colour') return <ColourParam doc={doc} l={l} p={p} />;
  const v = l.params[p.key] ?? p.def;
  if (p.kind === 'toggle')
    return (
      <InspectorRow label="">
        <Toggle label={p.label} checked={!!v} onChange={(on) => set(`${on ? 'Turn on' : 'Turn off'} ${labelOf(l)} ${p.label.toLowerCase()}`, on)} />
      </InspectorRow>
    );
  const options = p.options.map((label, n) => ({ value: String(n), label }));
  const pick = (to: string) => set(`${labelOf(l)}: ${p.options[Number(to)] ?? to}`, Number(to));
  return options.length <= 4 ? (
    <Segmented label={p.label} options={options} value={String(v)} onChange={pick} />
  ) : (
    <InspectorRow label={p.label}>
      <Select options={options} value={String(v)} onChange={pick} className={s.grow} />
    </InspectorRow>
  );
}

/** what the rates a second come to in this loop: whole counts, so the loop comes round exactly */
function loopNote(params: readonly Param[], l: Layer, seconds: number): string {
  const counts = params.flatMap((p) => (p.kind === 'number' && p.unit === '/s' ? [`${p.label} ${perLoop((l.params[p.key] as number | undefined) ?? p.def, seconds)}`] : []));
  return `Over the ${seconds.toFixed(2)} s loop: ${counts.join(', ')}.`;
}

/** the settings of layer `l`, for the stack to draw under its row */
export function LayerBody({ doc, d, l, t }: { doc: Doc; d: PostFxDoc; l: Layer; t: Timeline }) {
  const fx = effectOf(l.effect);
  const colours = fx?.params.some((p) => p.kind === 'colour' && p.tone !== undefined) ?? false;
  useReadAhead(colours);
  if (!fx) return null;
  return (
    <div className={s.body} data-layer-body={l.id}>
      <LayerMix doc={doc} l={l} />
      {fx.params.map((p) => (
        <ParamRow key={`${l.id}:${p.key}`} doc={doc} l={l} p={p} />
      ))}
      {colours && (
        <InspectorRow label="Colours from">
          <button
            type="button"
            className={s.from}
            aria-haspopup="menu"
            onClick={(e: MouseEvent<HTMLButtonElement>) => menu.open(e.currentTarget.getBoundingClientRect(), paletteMenu('postfx'), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}
          >
            <SwatchStrip colors={fx.params.flatMap((p) => (p.kind === 'colour' && p.tone !== undefined ? [cssColor((l.params[p.key] as Oklch | undefined) ?? p.def)] : []))} height={14} className={s.strip} />
            <span className={s.fromName}>Pick from a Library palette…</span>
          </button>
        </InspectorRow>
      )}
      {fx.moving && (
        <p className={s.note}>
          {loopNote(fx.params, l, t.kind === 'still' ? d.loop.seconds : t.seconds)}
          <InfoTip text="Rates are whole counts per loop, so the effect repeats exactly." />
        </p>
      )}
      {fx.videoOnly && (
        <p className={s.note}>
          Builds on the frame before it.
          <InfoTip text={`Each frame builds on the one before. A frame on its own is drawn after the ${RUN_IN} before it, as the playing picture is; a PNG sequence from the start has all of them.`} />
        </p>
      )}
    </div>
  );
}

function LayerMix({ doc, l }: { doc: Doc; l: Layer }) {
  const opacity = useDocNumber(doc, {
    label: `Change ${labelOf(l)} opacity`,
    key: `${l.id}:opacity`,
    get: (x) => Math.round((x.stack.find((y) => y.id === l.id)?.opacity ?? 1) * 100),
    set: (x, v) => mapLayer(x, l.id, (y) => ({ ...y, opacity: Math.min(1, Math.max(0, v / 100)) })),
  });
  return (
    <>
      <Slider label="Opacity" min={0} max={100} step={1} unit="%" {...opacity} />
      <InspectorRow label="Blend">
        <Select
          options={BLENDS.map((b) => ({ value: b.id, label: b.label }))}
          value={l.blend}
          onChange={(blend) => doc.transact(`Blend ${labelOf(l)} as ${BLENDS.find((b) => b.id === blend)?.label.toLowerCase()}`, (x) => mapLayer(x, l.id, (y) => ({ ...y, blend })))}
          className={s.grow}
        />
      </InspectorRow>
    </>
  );
}
