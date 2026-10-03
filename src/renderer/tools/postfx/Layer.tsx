// The selected layer (plan unit V): its opacity and blend, then the effect's own settings, each a
// Slider with its NumberField, a Toggle, a choice, or a ColorField. The colour effects take their
// colours from a Library palette too (Send to: EFFECT COLOURS lands on the selected layer).
import { useEffect, type MouseEvent } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import { itemInfo } from '../../shell/library/item-info.ts';
import { ColorField, Icon, IconButton, menu, Module, Segmented, Select, Slider, SwatchStrip, Toggle, useDocColour, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { labelOf, resetLayer, type Doc } from './actions.ts';
import { BLENDS, effectOf, GROUPS, type Param } from './effects/index.ts';
import { perLoop } from './effects/params.ts';
import { mapLayer, offered, RUN_IN, type Layer, type PostFxDoc, type Timeline } from './doc.ts';
import { VIDEO_ONLY_TIP } from './EffectPicker.tsx';
import { useView } from './view-state.ts';
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
    <div className={s.row}>
      <span className={cx('lbl', s.lab)}>{p.label}</span>
      <ColorField {...bind} className={s.grow} />
    </div>
  );
}

function ParamRow({ doc, l, p }: { doc: Doc; l: Layer; p: Param }) {
  const set = (label: string, v: Layer['params'][string]) => doc.transact(label, (x) => setParam(x, l.id, p.key, v));
  if (p.kind === 'number') return <NumberParam doc={doc} l={l} p={p} />;
  if (p.kind === 'colour') return <ColourParam doc={doc} l={l} p={p} />;
  const v = l.params[p.key] ?? p.def;
  if (p.kind === 'toggle')
    return (
      <div className={s.row}>
        <span className={cx('lbl', s.lab)} />
        <Toggle label={p.label} checked={!!v} onChange={(on) => set(`${on ? 'Turn on' : 'Turn off'} ${labelOf(l)} ${p.label.toLowerCase()}`, on)} />
      </div>
    );
  const options = p.options.map((label, n) => ({ value: String(n), label }));
  const pick = (to: string) => set(`${labelOf(l)}: ${p.options[Number(to)] ?? to}`, Number(to));
  return options.length <= 4 ? (
    <Segmented label={p.label} options={options} value={String(v)} onChange={pick} />
  ) : (
    <div className={s.row}>
      <span className={cx('lbl', s.lab)}>{p.label}</span>
      <Select options={options} value={String(v)} onChange={pick} className={s.grow} />
    </div>
  );
}

/** the Library's palettes, by collection, each with its colours; picking one colours this layer */
function paletteMenu(l: Layer, library: ReturnType<typeof shell.getState>['library']): MenuItem[] {
  const groups = (library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((x) => x.kind === 'palette') })).filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No palettes in the Library yet', disabled: true }];
  return groups.flatMap((g) => [
    { header: g.name },
    ...g.items.map((ref) => {
      const colours = itemInfo(ref)?.colors;
      return { label: ref.name, strip: colours, hint: colours && `${colours.length}`, onSelect: () => void shell.sendItem(ref, 'postfx') };
    }),
  ]);
}

/** what the rates a second come to in this loop: whole counts, so the loop comes round exactly */
function loopNote(params: readonly Param[], l: Layer, seconds: number): string {
  const counts = params.flatMap((p) => (p.kind === 'number' && p.unit === '/s' ? [`${p.label} ${perLoop((l.params[p.key] as number | undefined) ?? p.def, seconds)}`] : []));
  return `Over this ${seconds.toFixed(2)} s loop: ${counts.join(', ')}. Whole counts, so it repeats exactly.`;
}

export function LayerModule({ doc, d, t }: { doc: Doc; d: PostFxDoc; t: Timeline }) {
  const { selected } = useView();
  const library = useShell((st) => st.library);
  const l = d.stack.find((x) => x.id === selected) ?? null;
  const fx = l ? effectOf(l.effect) : undefined;
  const colours = fx?.params.some((p) => p.kind === 'colour' && p.tone !== undefined) ?? false;
  // the Library's palettes are read ahead, so the menu can show their colours
  useEffect(() => {
    if (colours) library?.collections.forEach((c) => c.items.forEach((ref) => ref.kind === 'palette' && itemInfo(ref, true)));
  }, [colours, library]);

  if (!l || !fx)
    return (
      <Module title="Layer">
        <p className={s.none}>{d.stack.length ? 'Pick a layer in the stack to set it.' : 'An effect’s settings show here once it is in the stack.'}</p>
      </Module>
    );

  const skipped = !offered(d, l.effect);
  const group = GROUPS.find((g) => g.id === fx.group)?.label;
  return (
    <Module
      title={fx.label}
      sub={group}
      actions={<IconButton icon="restart_alt" label={`Reset ${fx.label} to its defaults`} size="sm" onClick={() => resetLayer(doc, l.id)} />}
    >
      <div className={s.stack}>
        {skipped && (
          <p className={s.warn} role="status">
            <Icon name="info" size={16} />
            {VIDEO_ONLY_TIP} It is skipped until a clip is open.
          </p>
        )}
        <div className={s.group}>
          <LayerMix doc={doc} l={l} />
        </div>
        {fx.params.length > 0 && (
          <div className={cx(s.group, s.rule)}>
            {fx.params.map((p) => (
              <ParamRow key={`${l.id}:${p.key}`} doc={doc} l={l} p={p} />
            ))}
          </div>
        )}
        {fx.moving && <p className={s.note}>{loopNote(fx.params, l, t.kind === 'still' ? d.loop.seconds : t.seconds)}</p>}
        {fx.videoOnly && !skipped && (
          <p className={s.note}>
            Each frame builds on the one before. A frame on its own is drawn after the {RUN_IN} before it, as the playing picture is; a PNG sequence from the start has all of them.
          </p>
        )}
        {colours && (
          <div className={cx(s.row, s.rule)}>
            <span className={cx('lbl', s.lab)}>Colours from</span>
            <button
              type="button"
              className={s.from}
              aria-haspopup="menu"
              onClick={(e: MouseEvent<HTMLButtonElement>) => menu.open(e.currentTarget.getBoundingClientRect(), paletteMenu(l, library), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}
            >
              <SwatchStrip colors={fx.params.flatMap((p) => (p.kind === 'colour' && p.tone !== undefined ? [cssColor((l.params[p.key] as Oklch | undefined) ?? p.def)] : []))} height={14} className={s.strip} />
              <span className={s.fromName}>Pick from a Library palette…</span>
            </button>
          </div>
        )}
      </div>
    </Module>
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
      <div className={s.row}>
        <span className={cx('lbl', s.lab)}>Blend</span>
        <Select
          options={BLENDS.map((b) => ({ value: b.id, label: b.label }))}
          value={l.blend}
          onChange={(blend) => doc.transact(`Blend ${labelOf(l)} as ${BLENDS.find((b) => b.id === blend)?.label.toLowerCase()}`, (x) => mapLayer(x, l.id, (y) => ({ ...y, blend })))}
          className={s.grow}
        />
      </div>
    </>
  );
}
