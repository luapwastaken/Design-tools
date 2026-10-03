// The Build tab (spec §3, UX pass): the ways to make colours as a list, the chosen one's settings
// beside it. Everything here proposes; ghost chips join the palette only when added.
import { useEffect, useRef, useState } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { PRESETS } from '../../../shared/palette/generate.ts';
import { gradientStops } from '../../../shared/palette/gradient.ts';
import { harmony } from '../../../shared/palette/harmony.ts';
import type { LoadedItem } from '../../../shared/types.ts';
import { useShell } from '../../shell/core/index.ts';
import { ipc } from '../../shell/core/ipc.ts';
import type { IconName } from '../../shell/tool.ts';
import { Button, IconButton, Module, NumberField, Segmented, Select, SwatchStrip, toast } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { ListDetail } from '../common/ListDetail.tsx';
import { activeSwatch, selection } from './actions.ts';
import { HARMONIES, runGenerate, runGradient, runHarmony } from './build.ts';
import { displayName, type BuildMethod, type DesignDoc, type DesignView } from './doc.ts';
import { proposals } from './proposals.ts';
import { extract, picture, takeImage, takeSvg, takeText } from './sources.ts';
import { patchView } from './view-state.ts';
import s from './Build.module.css';

/** in the list: what each makes; in its detail's header: how */
const METHODS: { id: BuildMethod; label: string; icon: IconName; verdict: string; sub: string }[] = [
  { id: 'generate', label: 'Generate', icon: 'casino', verdict: 'A fresh palette in a style', sub: 'Seeded, with locks' },
  { id: 'harmony', label: 'Harmony', icon: 'join', verdict: 'From the selected colour', sub: 'From the selected swatch' },
  { id: 'image', label: 'From image', icon: 'image', verdict: 'Pull colours from a picture', sub: 'K-means in OKLab' },
  { id: 'logo', label: 'From logo', icon: 'web_asset', verdict: 'A logo’s fill colours', sub: 'Its fill and stroke colours' },
  { id: 'gradient', label: 'Gradient', icon: 'gradient', verdict: 'Steps between two swatches', sub: 'OKLCH or OKLab' },
  { id: 'paste', label: 'Paste', icon: 'content_paste', verdict: 'Hex, RGB, HSL or OKLCH codes', sub: 'One per line, or comma separated' },
];

const failed = (what: string) => (e: unknown) => toast.show({ kind: 'error', message: `${what}: ${e instanceof Error ? e.message : String(e)}` });

async function takeFile(file: File): Promise<void> {
  const name = file.name.replace(/\.[^.]*$/, '') || 'Image';
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') takeSvg([await file.text()], name);
  else await takeImage(file, name);
}

export function Build({ d, v }: { d: DesignDoc; v: DesignView }) {
  const items = METHODS.map((m) => ({
    ...m,
    detail: m.id === v.build && (
      <Module title={m.label} sub={m.sub} scroll>
        <div className={s.body}>
          <Method id={m.id} d={d} v={v} />
        </div>
      </Module>
    ),
  }));
  return <ListDetail items={items} value={v.build} onChange={(id) => patchView({ build: id as BuildMethod })} />;
}

function Method({ id, d, v }: { id: BuildMethod; d: DesignDoc; v: DesignView }) {
  switch (id) {
    case 'generate':
      return <Generate d={d} v={v} />;
    case 'harmony':
      return <Harmony d={d} v={v} />;
    case 'image':
      return <Image v={v} />;
    case 'logo':
      return <Logo />;
    case 'gradient':
      return <Gradient d={d} v={v} />;
    case 'paste':
      return <Paste />;
  }
}

function Harmony({ d, v }: { d: DesignDoc; v: DesignView }) {
  const base = activeSwatch(d, v);
  const shown = proposals.use();
  if (!base) return <p className={s.hint}>Add or pick a colour first: harmonies build from the selected swatch.</p>;
  return (
    <div className={s.list} role="list">
      {HARMONIES.map((h) => {
        const cols = harmony(base.oklch, h.kind);
        const on = shown?.from === 'harmony' && shown.label === `${h.label} of ${displayName(base)}`;
        return (
          <button key={h.kind} type="button" role="listitem" className={cx(s.hrow, on && s.on)} onClick={() => runHarmony(base, h.kind)}>
            <span className={s.hname}>{h.label}</span>
            <SwatchStrip colors={[base.oklch, ...cols].map(cssColor)} height={18} className={s.hstrip} />
            <span className={s.count}>+{cols.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function Generate({ d, v }: { d: DesignDoc; v: DesignView }) {
  const set = (patch: Partial<DesignView>) => {
    patchView(patch);
    runGenerate(d.swatches, { ...v, ...patch });
  };
  const preset = PRESETS.find((p) => p.id === v.preset);
  return (
    <>
      <Select label="Style" options={PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={v.preset} onChange={(p) => set({ preset: p })} />
      {preset && <p className={s.hint}>{preset.describe}</p>}
      <div className={s.row}>
        <NumberField label="Colours" value={v.count} min={2} max={12} step={1} onChange={(count) => set({ count })} className={s.grow} />
        <NumberField label="Seed" value={v.seed} min={0} max={99999} step={1} onChange={(seed) => set({ seed })} className={s.grow} />
        <IconButton icon="casino" label="Reroll: a new seed, locked proposals kept" onClick={() => set({ seed: 1 + Math.floor(Math.random() * 99999) })} />
      </div>
      <div className={s.row}>
        <Button variant="primary" size="lg" icon="star_shine" onClick={() => runGenerate(d.swatches, v)}>
          Generate
        </Button>
        <span className={s.dim}>New colours land at the end of the palette as proposals, leaving room for its own. Add the ones you like; lock one to keep it through a reroll.</span>
      </div>
    </>
  );
}

function Image({ v }: { v: DesignView }) {
  const pic = picture.use();
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pic) return;
    c.width = pic.pixels.width;
    c.height = pic.pixels.height;
    c.getContext('2d')!.putImageData(pic.pixels, 0, 0);
  }, [pic]);
  return (
    <>
      {pic ? (
        <div className={s.pic}>
          <canvas ref={canvas} className={s.thumb} aria-label={pic.name} />
          <span className={s.picName}>{pic.name}</span>
        </div>
      ) : (
        <p className={s.drop}>Drop or paste an image anywhere in Design, send one from the Library, or choose one.</p>
      )}
      <div className={s.row}>
        <NumberField
          label="Colours"
          value={v.k}
          min={2}
          max={10}
          step={1}
          onChange={(k) => {
            patchView({ k });
            extract(k);
          }}
          className={s.grow}
        />
        <Button icon="upload_file" onClick={() => input.current?.click()}>
          Choose image
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void takeFile(file).catch(failed(`Couldn't take colours from ${file.name}`));
        }}
      />
    </>
  );
}

function Logo() {
  const library = useShell((st) => st.library);
  const [chosen, setChosen] = useState('');
  const items = library?.collections.flatMap((c) => c.items.filter((i) => i.kind === 'logo' || i.kind === 'svg')) ?? [];
  const pick = async (id: string) => {
    setChosen(id);
    const item: LoadedItem = await ipc.invoke('library.read', id);
    if (item.kind === 'logo') takeSvg([item.payload.preview?.svg, item.payload.icon, item.payload.wordmark], item.ref.name);
    else if (item.kind === 'svg') takeSvg([await (await fetch(item.url)).text()], item.ref.name);
  };
  return (
    <>
      <Select
        label="Logo"
        options={[{ value: '', label: items.length ? 'Choose a logo or SVG' : 'None in the Library yet' }, ...items.map((i) => ({ value: i.id, label: i.name }))]}
        value={items.some((i) => i.id === chosen) ? chosen : ''}
        onChange={(id) => id && void pick(id).catch(failed("Couldn't read that logo"))}
        disabled={!items.length}
      />
      <p className={s.hint}>Its fill and stroke colours become proposals. You can also send a logo or SVG here from the Library, or drop an SVG.</p>
    </>
  );
}

function Gradient({ d, v }: { d: DesignDoc; v: DesignView }) {
  const sel = selection(d, v);
  const [ends, setEnds] = useState<{ from?: string; to?: string }>({});
  const find = (id?: string) => d.swatches.find((w) => w.id === id);
  const a = find(ends.from) ?? find(sel[0]) ?? d.swatches[0];
  const b = find(ends.to) ?? find(sel[1]) ?? d.swatches.at(-1);
  const live = proposals.use()?.from === 'gradient';
  if (!a || !b || d.swatches.length < 2) return <p className={s.hint}>Add two swatches to blend between them.</p>;

  const opts = d.swatches.map((w) => ({ value: w.id, label: displayName(w), swatch: cssColor(w.oklch) }));
  const stops = gradientStops(a.oklch, b.oklch, v.stops, v.space);
  // while its stops are the ones proposed, a changed setting updates them
  const change = (next: { from?: string; to?: string }, patch: Partial<DesignView> = {}) => {
    setEnds({ ...ends, ...next });
    if (Object.keys(patch).length) patchView(patch);
    if (live) runGradient(find(next.from ?? a.id)!, find(next.to ?? b.id)!, { ...v, ...patch });
  };
  return (
    <>
      <div className={s.row}>
        <Select label="From" options={opts} value={a.id} onChange={(from) => change({ from })} className={s.grow} />
        <Select label="To" options={opts} value={b.id} onChange={(to) => change({ to })} className={s.grow} />
      </div>
      <div className={s.row}>
        <NumberField label="Stops" value={v.stops} min={1} max={12} step={1} onChange={(n) => change({}, { stops: n })} className={s.grow} />
        <Segmented mono options={[{ value: 'oklch', label: 'OKLCH' }, { value: 'oklab', label: 'OKLab' }]} value={v.space} onChange={(space) => change({}, { space })} />
      </div>
      <SwatchStrip colors={[a.oklch, ...stops, b.oklch].map(cssColor)} height={22} />
      <div className={s.row}>
        <Button icon="add" onClick={() => runGradient(a, b, v)}>
          Propose {stops.length === 1 ? 'the stop' : `${stops.length} stops`}
        </Button>
      </div>
    </>
  );
}

function Paste() {
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const parse = () => {
    const r = takeText(text);
    const skipped = r.rejected.length ? ` Skipped ${r.rejected.slice(0, 3).map((x) => `“${x}”`).join(', ')}${r.rejected.length > 3 ? ` and ${r.rejected.length - 3} more` : ''}.` : '';
    setNote(r.found ? `Found ${r.found === 1 ? 'one colour' : `${r.found} colours`}.${skipped}` : `No colours found.${skipped} Use one of the forms above.`);
  };
  return (
    <>
      {/* as text, not a placeholder: the examples are copy, and they stay visible while typing */}
      <p className={s.forms}>#E8643C · rgb(232, 100, 60) · hsl(14 79% 57%) · oklch(0.66 0.17 37) · Ember: #E8643C</p>
      <textarea
        className={s.paste}
        value={text}
        spellCheck={false}
        aria-label="Colours to parse"
        onChange={(e) => {
          setText(e.target.value);
          setNote(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            parse();
          }
        }}
      />
      <div className={s.row}>
        <Button icon="content_paste" onClick={parse} disabled={!text.trim()} shortcut="Ctrl+Enter" tooltip="Parse">
          Parse
        </Button>
        <span className={s.dim}>One per line, or separated by commas.</span>
      </div>
      {note && <p className={s.hint}>{note}</p>}
    </>
  );
}
