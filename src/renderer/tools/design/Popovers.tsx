// The "+ Add" sources as popovers under the control that opened them (SPEC 3): From image, From
// logo, Paste codes, Harmony from a colour, Insert gradient, Suggest more colours; and the style and
// accent that rerolls the palette. Each source only proposes: the colours land in the row as
// proposals, never in the document until kept.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { gradientStops } from '../../../shared/palette/gradient.ts';
import { PRESETS } from '../../../shared/palette/generate.ts';
import { harmony } from '../../../shared/palette/harmony.ts';
import { parseColours } from '../../../shared/palette/paste.ts';
import type { LoadedItem } from '../../../shared/types.ts';
import { useShell } from '../../shell/core/index.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { cx } from '../../ui/cx.ts';
import { HexField } from '../../ui/HexField.tsx';
import { Button, IconButton, NumberField, Popover, Segmented, Select, SwatchStrip, toast } from '../../ui/index.ts';
import { HARMONIES, runGradient, runHarmony } from './build.ts';
import { displayName, type DesignDoc, type DesignView } from './doc.ts';
import { proposals } from './proposals.ts';
import { extract, picture, takeImage, takeSvg, takeText } from './sources.ts';
import { activeSwatch, regenerate, restyle, seedGesture, selection, suggestMore, type Doc } from './actions.ts';
import { AccentField, StyleField } from './StyleFields.tsx';
import { patchView } from './view-state.ts';
import s from './Popovers.module.css';

export type PopKind = 'image' | 'logo' | 'paste' | 'colour' | 'gradient' | 'style' | 'suggest';
export type OpenPop = (kind: PopKind, anchor: HTMLElement, ends?: { from: string; to: string }) => void;

export type PopState = { kind: PopKind; anchor: HTMLElement; ends?: { from: string; to: string } };

const TITLES: Record<PopKind, string> = {
  image: 'From image',
  logo: 'From logo',
  paste: 'Paste codes',
  colour: 'Harmony from a colour',
  gradient: 'Gradient between two',
  style: 'Style and accent',
  suggest: 'Suggest more colours',
};

const failed = (what: string) => (e: unknown) => toast.show({ kind: 'error', message: `${what}: ${e instanceof Error ? e.message : String(e)}` });

async function takeFile(file: File): Promise<void> {
  const name = file.name.replace(/\.[^.]*$/, '') || 'Image';
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') takeSvg([await file.text()], name);
  else await takeImage(file, name);
}

export function DesignPopover({ doc, pop, d, v, onClose }: { doc: Doc; pop: PopState; d: DesignDoc; v: DesignView; onClose(refocus: boolean): void }) {
  return (
    <Popover anchor={pop.anchor} label={TITLES[pop.kind]} onClose={onClose} className={s.pop}>
      <div className={s.body}>
        <span className={s.head}>{TITLES[pop.kind]}</span>
        {pop.kind === 'style' && <StyleBody doc={doc} v={v} />}
        {pop.kind === 'suggest' && <SuggestBody doc={doc} v={v} onDone={() => onClose(true)} />}
        {pop.kind === 'image' && <ImageBody v={v} onDone={() => onClose(true)} />}
        {pop.kind === 'logo' && <LogoBody onDone={() => onClose(true)} />}
        {pop.kind === 'paste' && <PasteBody onDone={() => onClose(true)} />}
        {pop.kind === 'colour' && <ColourBody d={d} v={v} onDone={() => onClose(true)} />}
        {pop.kind === 'gradient' && <GradientBody d={d} v={v} ends={pop.ends} onDone={() => onClose(true)} />}
      </div>
    </Popover>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className={s.row}>{children}</div>;
}

/** Style, Accent and Seed: a change rerolls the unlocked colours in place (the same seed only changes what the style or accent changes) */
function StyleBody({ doc, v }: { doc: Doc; v: DesignView }) {
  // one gesture for a scrub or a typed seed, so it is one undo step and one toast, whatever it re-renders between
  const seed = useMemo(() => seedGesture(doc), [doc]);
  return (
    <>
      <Row>
        <StyleField doc={doc} v={v} className={s.grow} />
      </Row>
      <Row>
        <AccentField doc={doc} v={v} className={s.grow} />
      </Row>
      <Row>
        <NumberField label="Seed" value={v.seed} min={0} max={99999} step={1} {...seed} className={s.grow} />
        <IconButton icon="casino" label="Reroll: a new seed" shortcut="Space" onClick={() => restyle(doc, { seed: 1 + Math.floor(Math.random() * 99999) })} />
      </Row>
      <p className={s.dim}>These rebuild every colour that has a role and is not locked. Press L on a colour to keep it.</p>
    </>
  );
}

/** the generator's ramp-shaped colours, proposed beside the palette: Colours and Seed redo them while they are up */
function SuggestBody({ doc, v, onDone }: { doc: Doc; v: DesignView; onDone(): void }) {
  const preset = PRESETS.find((p) => p.id === v.suggestStyle);
  return (
    <>
      <Row>
        <Select label="Style" options={PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={v.suggestStyle} onChange={(suggestStyle) => regenerate(doc, { suggestStyle })} className={s.grow} />
        <Select
          label="Hues from"
          options={[
            { value: 'all', label: 'All colours' },
            { value: 'selected', label: 'Selected colour' },
          ]}
          value={v.suggestFrom}
          onChange={(suggestFrom) => regenerate(doc, { suggestFrom })}
          className={s.grow}
        />
      </Row>
      <Row>
        <NumberField label="Colours" value={v.count} min={2} max={12} step={1} onChange={(count) => regenerate(doc, { count })} className={s.grow} />
      </Row>
      <Row>
        <NumberField label="Seed" value={v.seed} min={0} max={99999} step={1} onChange={(seed) => regenerate(doc, { seed })} className={s.grow} />
        <IconButton icon="casino" label="Another seed" onClick={() => regenerate(doc, { seed: 1 + Math.floor(Math.random() * 99999) })} />
      </Row>
      <p className={s.dim}>{preset ? `${preset.label}: ${preset.describe} ` : ''}They arrive as proposals and your palette stays as it is.</p>
      <Button
        icon="add"
        variant="primary"
        onClick={() => {
          suggestMore(doc);
          onDone();
        }}
      >
        Propose {v.count} colours
      </Button>
    </>
  );
}

function ImageBody({ v, onDone }: { v: DesignView; onDone(): void }) {
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
        <p className={s.drop}>Drop an image anywhere in Design, send one from the Library, or choose one.</p>
      )}
      <Row>
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
        <Button icon="upload_file" variant={pic ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>
          {pic ? 'Another image' : 'Choose image'}
        </Button>
      </Row>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void takeFile(file).then(onDone, failed(`Couldn't take colours from ${file.name}`));
        }}
      />
    </>
  );
}

function LogoBody({ onDone }: { onDone(): void }) {
  const library = useShell((st) => st.library);
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState('');
  const items = library?.collections.flatMap((c) => c.items.filter((i) => i.kind === 'logo' || i.kind === 'svg')) ?? [];
  const pick = async (id: string) => {
    setChosen(id);
    const item: LoadedItem = await ipc.invoke('library.read', id);
    if (item.kind === 'logo') takeSvg([item.payload.preview?.svg, item.payload.icon, item.payload.wordmark], item.ref.name);
    else if (item.kind === 'svg') takeSvg([await (await fetch(item.url)).text()], item.ref.name);
    onDone();
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
      <Button icon="upload_file" variant={items.length ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>
        Choose SVG
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/svg+xml,.svg"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void takeFile(file).then(onDone, failed(`Couldn't take colours from ${file.name}`));
        }}
      />
      <p className={s.dim}>Its fill and stroke colours become proposals. You can also drop an SVG here.</p>
    </>
  );
}

function PasteBody({ onDone }: { onDone(): void }) {
  const [text, setText] = useState('');
  const read = parseColours(text);
  const add = () => {
    if (!read.colours.length) return;
    takeText(text);
    onDone();
  };
  return (
    <>
      {/* as text, not a placeholder: the examples are copy, and they stay visible while typing */}
      <p className={s.forms}>#E8643C · rgb(232, 100, 60) · hsl(14 79% 57%) · oklch(0.66 0.17 37) · 232 100 60 · Ember: #E8643C</p>
      <textarea
        className={s.paste}
        value={text}
        spellCheck={false}
        aria-label="Colours to parse"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            add();
          }
        }}
      />
      {read.colours.length > 0 && <SwatchStrip colors={read.colours.map(cssColor)} height={22} />}
      {read.rejected.length > 0 && (
        <p className={s.dim}>
          Skipped: {read.rejected.slice(0, 4).join(' / ')}
          {read.rejected.length > 4 ? ` and ${read.rejected.length - 4} more` : ''}
        </p>
      )}
      <Row>
        <span className={cx(s.dim, s.grow)}>
          {!text.trim()
            ? 'One per line, or separated by commas.'
            : read.colours.length
              ? `${read.colours.length === 1 ? 'One colour' : `${read.colours.length} colours`} found${read.rejected.length ? `, ${read.rejected.length} skipped` : ''}.${read.notes.map((n) => ` ${n}.`).join('')}`
              : 'No colours found.'}
        </span>
        <Button icon="content_paste" variant="primary" onClick={add} disabled={!read.colours.length} shortcut="Ctrl+Enter" tooltip="Show them in the palette row as proposals; Keep all adds them">
          Propose colours
        </Button>
      </Row>
    </>
  );
}

const SEED: Oklch = [0.62, 0.15, 35];

/** the selected swatch, or a typed colour, with the harmony that builds on it */
function ColourBody({ d, v, onDone }: { d: DesignDoc; v: DesignView; onDone(): void }) {
  const base = activeSwatch(d, v);
  const [typed, setTyped] = useState<Oklch | null>(null);
  const colour = typed ?? base?.oklch ?? SEED;
  // a typed colour that is not the selected swatch's own is proposed too
  const fresh = !base || toHex(colour) !== toHex(base.oklch);
  const shown = proposals.use();
  const name = fresh ? 'this colour' : displayName(base!);
  return (
    <>
      <HexField value={colour} name={base && !fresh ? displayName(base) : undefined} onChange={setTyped} />
      <div className={s.list} role="list">
        {HARMONIES.map((h) => {
          const cols = harmony(colour, h.kind);
          const on = shown?.from === 'harmony' && shown.label === `${h.label} of ${fresh ? displayName({ name: '', oklch: colour }) : displayName(base!)}`;
          return (
            <button
              key={h.kind}
              type="button"
              role="listitem"
              className={cx(s.hrow, on && s.on)}
              onClick={() => {
                runHarmony({ name: fresh ? '' : base!.name, oklch: colour }, h.kind, fresh);
                onDone();
              }}
            >
              <span className={s.hname}>{h.label}</span>
              <SwatchStrip colors={[colour, ...cols].map(cssColor)} height={18} className={s.hstrip} />
              <span className={s.count}>+{cols.length}</span>
            </button>
          );
        })}
      </div>
      <p className={s.dim}>{fresh ? 'Proposed with the colour itself.' : `Built around ${name}.`}</p>
    </>
  );
}

function GradientBody({ d, v, ends, onDone }: { d: DesignDoc; v: DesignView; ends?: { from: string; to: string }; onDone(): void }) {
  const sel = selection(d, v);
  const [pick, setPick] = useState<{ from?: string; to?: string }>(ends ?? {});
  const find = (id?: string) => d.swatches.find((w) => w.id === id);
  const a = find(pick.from) ?? find(sel[0]) ?? d.swatches[0];
  const b = find(pick.to) ?? find(sel[1]) ?? d.swatches.at(-1);
  const live = proposals.use()?.from === 'gradient';
  if (!a || !b || d.swatches.length < 2) return <p className={s.dim}>Add two swatches to blend between them.</p>;
  // while its stops are the ones proposed, a changed setting updates them
  const change = (next: { from?: string; to?: string }, patch: Partial<DesignView> = {}) => {
    setPick({ ...pick, ...next });
    if (Object.keys(patch).length) patchView(patch);
    if (live) runGradient(find(next.from ?? a.id)!, find(next.to ?? b.id)!, { ...v, ...patch });
  };
  const opts = d.swatches.map((w) => ({ value: w.id, label: displayName(w), swatch: cssColor(w.oklch) }));
  const stops = gradientStops(a.oklch, b.oklch, v.stops, v.space);
  return (
    <>
      <Row>
        <Select label="From" options={opts} value={a.id} onChange={(from) => change({ from })} className={s.grow} />
        <Select label="To" options={opts} value={b.id} onChange={(to) => change({ to })} className={s.grow} />
      </Row>
      <Row>
        <NumberField label="Stops" value={v.stops} min={1} max={12} step={1} onChange={(n) => change({}, { stops: n })} className={s.grow} />
        <Segmented mono options={[{ value: 'oklch', label: 'OKLCH' }, { value: 'oklab', label: 'OKLab' }]} value={v.space} onChange={(space) => change({}, { space })} />
      </Row>
      <SwatchStrip colors={[a.oklch, ...stops, b.oklch].map(cssColor)} height={22} />
      <Button
        icon="add"
        variant="primary"
        onClick={() => {
          runGradient(a, b, v);
          onDone();
        }}
      >
        Propose {stops.length === 1 ? 'the stop' : `${stops.length} stops`}
      </Button>
    </>
  );
}
