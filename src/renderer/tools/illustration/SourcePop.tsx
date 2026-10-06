// The popover of a source that stages several colours (From… > From image, Paste codes, From
// Library, a limited set). The staged colours are the proposals: chips over
// their value strips, light to dark; click one to leave it out. "Make N ramps" adds them to this
// palette, lit by the Light row. The same colours wait in the Ramps list if the popover is closed.
import { useEffect, useRef, useState } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { greyOf, valueOf } from '../../../shared/color/value.ts';
import { parseColours } from '../../../shared/palette/paste.ts';
import type { LibraryItemRef } from '../../../shared/types.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, NumberField, Popover, Select, SwatchStrip, toast, Tooltip } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { addProposals, selected, type Doc } from './actions.ts';
import type { IllustrationDoc } from './doc.ts';
import { COLOURS, dropProposals, extract, picture, pickPixel, proposals, takeImage, type Proposal, type SourcePop } from './proposals.ts';
import { MAX_RAMPS, SETS } from './scene.ts';
import { openPalette, readPalette, stagePalette, stagePaste, stageSet, startHue } from './starts.ts';
import s from './SourcePop.module.css';

const TITLES = { image: 'From image', paste: 'Paste codes', library: 'From Library', set: 'Limited set' } as const;

type Props = { doc: Doc; d: IllustrationDoc; pop: SourcePop; anchor: HTMLElement; onClose(refocus: boolean): void };

export function SourcePopover({ doc, d, pop, anchor, onClose }: Props) {
  const staged = proposals.use();
  const mine = staged?.from === pop.source ? staged : null;
  const items = mine?.items ?? [];
  const room = Math.max(0, MAX_RAMPS - d.ramps.length);
  const n = Math.min(items.length, room);
  const make = () => {
    if (!n) return;
    addProposals(doc, items);
    onClose(true);
  };
  return (
    <Popover anchor={anchor} label={TITLES[pop.source]} onClose={onClose} className={s.pop}>
      <div className={s.body}>
        <span className={s.head}>{TITLES[pop.source]}</span>
        {pop.source === 'image' && <ImageBody />}
        {pop.source === 'paste' && <PasteBody initial={pop.text ?? ''} onMake={make} />}
        {pop.source === 'library' && <LibraryBody doc={doc} onClose={onClose} />}
        {pop.source === 'set' && <SetBody d={d} initial={pop.set} />}
        <Candidates items={items} />
        {mine?.note && <p className={s.dim}>{mine.note}</p>}
        {items.length > room && <p className={s.dim}>{room ? `This palette has room for ${plural(room, 'more ramp')}: the first ${n} are made.` : `This palette already holds ${MAX_RAMPS} ramps. Delete one to add more.`}</p>}
        {items.length > 0 && <p className={s.dim}>Light to dark. Click a colour to leave it out.</p>}
        <div className={s.foot}>
          <Button variant="primary" icon="add" disabled={!n} onClick={make}>
            {n === 1 ? 'Make 1 ramp' : `Make ${n} ramps`}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

/** the staged colours as chips, each over its value (the grey it becomes), light to dark */
function Candidates({ items }: { items: Proposal[] }) {
  if (!items.length) return null;
  return (
    <div className={s.chips} role="group" aria-label="Colours to make ramps from" data-candidates="">
      {items.map((it) => {
        const hex = toHex(it.oklch).toUpperCase();
        return (
          <Tooltip key={it.id} content={`${it.name ?? hex} · value ${Math.round(valueOf(it.oklch) * 100)} · click to leave it out`}>
            <button type="button" className={s.chip} aria-label={`Leave out ${it.name ?? hex}`} data-candidate={hex} onClick={() => dropProposals([it.id])}>
              <i className={s.colour} data-colour="" style={{ background: cssColor(it.oklch) }} />
              <i className={s.value} data-colour="" style={{ background: cssColor(greyOf(valueOf(it.oklch))) }} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ImageBody() {
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
          <Tooltip content="Click the picture to add the colour under the pointer">
            <canvas
              ref={canvas}
              className={s.thumb}
              data-colour=""
              aria-label={pic.name}
              onClick={(e) => {
                // the picture is drawn contained in its box: undo that scale to find the pixel
                const box = e.currentTarget.getBoundingClientRect();
                const scale = Math.min(box.width / pic.pixels.width, box.height / pic.pixels.height);
                pickPixel((e.clientX - box.left - (box.width - pic.pixels.width * scale) / 2) / scale, (e.clientY - box.top - (box.height - pic.pixels.height * scale) / 2) / scale);
              }}
            />
          </Tooltip>
          <span className={s.picName}>{pic.name}</span>
        </div>
      ) : (
        <p className={s.drop}>Drop an image anywhere in Illustration, send one from the Library, or choose one.</p>
      )}
      <div className={s.row}>
        <NumberField label="Colours" value={pic?.k ?? COLOURS.start} min={COLOURS.min} max={COLOURS.max} step={1} disabled={!pic} onChange={(k) => extract(k)} className={s.grow} />
        <Button icon="upload_file" variant={pic ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>
          {pic ? 'Another image' : 'Choose image'}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        hidden
        data-illustration-image=""
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void takeImage(file, file.name.replace(/\.[^.]*$/, '') || 'The image').catch((err: unknown) => toast.show({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
        }}
      />
    </>
  );
}

function PasteBody({ initial, onMake }: { initial: string; onMake(): void }) {
  const [text, setText] = useState(initial);
  const read = parseColours(text);
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
          stagePaste(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            onMake();
          }
        }}
      />
      <span className={s.dim} data-found="">
        {!text.trim() ? 'One per line, or separated by commas.' : read.colours.length ? `${read.colours.length === 1 ? 'One colour' : `${read.colours.length} colours`} found${read.rejected.length ? `, ${read.rejected.length} skipped` : ''}.` : 'No colours found.'}
      </span>
      {read.colours.length > 0 && <SwatchStrip colors={read.colours.map(cssColor)} height={14} />}
    </>
  );
}

function LibraryBody({ doc, onClose }: { doc: Doc; onClose(refocus: boolean): void }) {
  const library = useShell((st) => st.library);
  const [chosen, setChosen] = useState('');
  const palettes = (library?.collections ?? []).flatMap((c) => c.items.filter((i) => i.kind === 'palette').map((ref) => ({ ref, label: c.name ? `${c.name} / ${ref.name}` : ref.name })));
  const ref: LibraryItemRef | undefined = palettes.find((p) => p.ref.id === chosen)?.ref;
  const pick = async (id: string) => {
    setChosen(id);
    const r = palettes.find((p) => p.ref.id === id)?.ref;
    const from = r && (await readPalette(r));
    if (r && from) stagePalette(doc.get(), from, r.name);
  };
  return (
    <>
      <Select
        label="Palette"
        options={[{ value: '', label: palettes.length ? 'Choose a palette' : 'None in the Library yet' }, ...palettes.map((p) => ({ value: p.ref.id, label: p.label }))]}
        value={ref ? chosen : ''}
        onChange={(id) => id && void pick(id)}
        disabled={!palettes.length}
      />
      <p className={s.dim}>Its colours are added to this palette as new ramps. A ramp from an Illustration palette keeps its material.</p>
      {ref && (
        <Button size="xs" variant="ghost" icon="open_in_new" className={s.own} onClick={() => void openPalette(doc, ref).then(() => onClose(false))} tooltip="Make a palette of its own from it, and leave this one as it is">
          Open as a palette of its own
        </Button>
      )}
    </>
  );
}

function SetBody({ d, initial }: { d: IllustrationDoc; initial?: string }) {
  const [id, setId] = useState(initial ?? SETS[0].id);
  const [hue, setHue] = useState(() => startHue(d, selected(d)?.id ?? null));
  const set = SETS.find((x) => x.id === id) ?? SETS[0];
  const change = (nextId: string, nextHue: number) => {
    setId(nextId);
    setHue(nextHue);
    stageSet(nextId, nextHue);
  };
  return (
    <>
      <Select label="Set" options={SETS.map((x) => ({ value: x.id, label: x.label }))} value={set.id} onChange={(v) => change(v, hue)} />
      <p className={s.dim}>{set.rule}</p>
      {set.usesHue && <NumberField label="Hue" value={hue} min={0} max={360} step={1} unit="°" onChange={(h) => change(set.id, h)} />}
    </>
  );
}
