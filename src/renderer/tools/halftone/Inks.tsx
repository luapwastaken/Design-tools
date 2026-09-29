// Inks (spec §3): CMYK process, or 1 to 6 spot inks from a Library palette, the shared ink list or
// picked by hand. Each ink shows, hides, turns and has its own transfer curve; they overprint or knock out.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { INKS } from '../../../shared/palette/inks.ts';
import { shell } from '../../shell/core/index.ts';
import { ColorField, ConfirmInline, FieldError, Icon, IconButton, menu, Module, NumberField, Segmented, SwatchStrip, TextInput, useDocColour, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { addInk, LIBRARIES, removeInk, setMode, type Doc } from './actions.ts';
import { Curve } from './Curve.tsx';
import { Dial } from './Dial.tsx';
import { foldAngle, isIdentity, LIMIT, mapInk, overlapOf, sharedScreen, type HalftoneDoc, type Ink } from './doc.ts';
import { inksFrom, patchView, useView } from './view-state.ts';
import s from './Inks.module.css';
import i from './Inspector.module.css';

export type PlateOf = (id: string) => { data: Float32Array; w: number; h: number } | null;

const MODES = [
  { value: 'process' as const, label: 'Process CMYK' },
  { value: 'spot' as const, label: 'Spot inks' },
];
const OVERLAPS = [
  { value: 'overprint' as const, label: 'Overprint', tip: 'Inks print over each other and multiply, as real ink does' },
  { value: 'knockout' as const, label: 'Knockout', tip: 'Each ink clears the ones before it where it prints' },
];

const LIB_NAME = { riso: 'Riso', ral: 'RAL', hks: 'HKS', ncs: 'NCS' } as const;

/** an ink from the shared list, named as a printer asks for it */
const libInk = (lib: keyof typeof LIB_NAME, k: (typeof INKS)['riso'][number]) => ({ name: lib === 'ral' ? `${k.id.replace(/^RAL/, 'RAL ')} ${k.name}` : k.name, colour: k.oklch });

/** Riso, RAL, HKS and NCS as submenus, and the palette the inks came from; `pick` gets the choice */
function inkMenu(pick: (name: string, colour: Oklch) => void): MenuItem[] {
  const from = inksFrom.get();
  const palette: MenuItem[] = from
    ? [{ header: from.name }, ...from.swatches.map((w) => ({ label: w.name, swatch: cssColor(w.colour), onSelect: () => pick(w.name, w.colour) })), 'separator']
    : [];
  return [
    ...palette,
    ...LIBRARIES.map(({ id, label }) => ({
      label,
      hint: `${INKS[id].length}`,
      submenu: INKS[id].map((k) => {
        const ink = libInk(id, k);
        return { label: ink.name, swatch: cssColor(ink.colour), onSelect: () => pick(ink.name, ink.colour) };
      }),
    })),
  ];
}

const openAt = (e: MouseEvent<HTMLButtonElement>, items: MenuItem[]) => menu.open(e.currentTarget.getBoundingClientRect(), items, { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });

/** the Library's palettes, by collection; picking one sends it here as the inks */
function paletteMenu(): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((x) => x.kind === 'palette') })).filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No palettes in the Library yet', disabled: true }];
  return groups.flatMap((g) => [{ header: g.name }, ...g.items.map((ref) => ({ label: ref.name, onSelect: () => void shell.sendItem(ref, 'halftone') }))]);
}

/** a plate as a small picture: its ink on the paper, at the plate's tone */
function PlateThumb({ plate, ink, paper }: { plate: ReturnType<PlateOf>; ink: Oklch; paper: Oklch }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const n = 34 * Math.ceil(devicePixelRatio);
    c.width = c.height = n;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = cssColor(paper);
    ctx.fillRect(0, 0, n, n);
    if (!plate) return;
    // cover the square from the plate's middle, one sample per thumbnail pixel
    const k = Math.min(plate.w, plate.h) / n;
    const x0 = (plate.w - n * k) / 2;
    const y0 = (plate.h - n * k) / 2;
    const mask = new ImageData(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) mask.data[(y * n + x) * 4 + 3] = Math.round(255 * plate.data[Math.floor(y0 + (y + 0.5) * k) * plate.w + Math.floor(x0 + (x + 0.5) * k)]);
    const layer = new OffscreenCanvas(n, n);
    const g = layer.getContext('2d')!;
    g.putImageData(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = cssColor(ink);
    g.fillRect(0, 0, n, n);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(layer, 0, 0);
  }, [plate, ink, paper]);
  return <canvas ref={ref} className={s.thumb} aria-hidden="true" />;
}

function InkRow({ doc, d, ink, n, plate, open, onOpen }: { doc: Doc; d: HalftoneDoc; ink: Ink; n: number; plate: ReturnType<PlateOf>; open: boolean; onOpen(): void }) {
  const angle = useDocNumber(doc, {
    label: `Turn the ${ink.name} screen`,
    key: `angle:${ink.id}`,
    get: (x) => x.inks.find((k) => k.id === ink.id)?.angle ?? 0,
    set: (x, v) => mapInk(x, ink.id, (k) => ({ ...k, angle: foldAngle(v) })),
  });
  const fm = d.screen.shape === 'stochastic';
  const channel = ink.process ? ink.process.toUpperCase() : `${n + 1}`;
  const from = inksFrom.use();
  const inPalette = from?.swatches.some((w) => toHex(w.colour) === toHex(ink.colour));
  // the angle column is too narrow for its message: it goes on a line of its own under the row
  const [angleError, setAngleError] = useState<string | null>(null);
  // hidden says more than process, and both don't fit beside the hex
  const tag = !ink.visible ? 'Hidden' : ink.process ? 'Process' : inPalette ? 'Palette' : null;
  return (
    <div className={cx(s.row, !ink.visible && s.hidden, open && s.open)}>
      <IconButton
        icon={ink.visible ? 'visibility' : 'visibility_off'}
        label={ink.visible ? `Hide ${ink.name}` : `Show ${ink.name}`}
        size="sm"
        onClick={() => doc.transact(ink.visible ? `Hide ${ink.name}` : `Show ${ink.name}`, (x) => mapInk(x, ink.id, (k) => ({ ...k, visible: !k.visible })))}
      />
      <PlateThumb plate={plate} ink={ink.colour} paper={d.paper.colour} />
      <span className={s.ch}>{channel}</span>
      <button type="button" className={s.name} aria-expanded={open} onClick={onOpen}>
        <span className={s.a}>
          <i className={s.chip} style={{ background: cssColor(ink.colour) }} />
          <span className={s.text}>{ink.name}</span>
          {!isIdentity(ink.curve) && <Icon name="show_chart" size={14} className={s.curved} />}
          <Icon name={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={14} className={s.more} />
        </span>
        <span className={s.b}>
          {toHex(ink.colour).toUpperCase()}
          {tag && <span className={s.tag}>{tag}</span>}
        </span>
      </button>
      <NumberField label={`${ink.name} angle`} hideLabel min={LIMIT.angle[0]} max={LIMIT.angle[1]} step={0.5} precision={1} unit="°" width={72} disabled={fm} onError={setAngleError} {...angle} />
      <Dial disabled={fm} {...angle} />
      {angleError && (
        <div className={s.rowError}>
          <FieldError>{angleError}</FieldError>
        </div>
      )}
    </div>
  );
}

/** the open ink's own settings: its colour, name, transfer curve, and Remove for a spot ink */
function InkEditor({ doc, d, ink }: { doc: Doc; d: HalftoneDoc; ink: Ink }) {
  const [arming, setArming] = useState(false);
  const colour = useDocColour(doc, {
    label: `Change ${ink.name}`,
    key: `colour:${ink.id}`,
    get: (x) => x.inks.find((k) => k.id === ink.id)?.colour ?? ink.colour,
    set: (x, o) => mapInk(x, ink.id, (k) => ({ ...k, colour: o })),
  });
  const swap = (name: string, c: Oklch) => doc.transact(`Use ${name} for ${ink.name}`, (x) => mapInk(x, ink.id, (k) => ({ ...k, name, colour: c })));
  if (arming)
    return (
      <div className={s.editor}>
        <ConfirmInline icon="delete" title={`Remove ${ink.name}?`} detail="Its plate goes; the other inks share the image again. Undo brings it back." confirmLabel="Remove" danger onConfirm={() => removeInk(doc, ink.id)} onKeep={() => setArming(false)} />
      </div>
    );
  return (
    <div className={s.editor}>
      <div className={i.row}>
        <ColorField {...colour} name={ink.name} className={i.grow} />
        <IconButton icon="format_paint" label="Use an ink from Riso, RAL, HKS or NCS" size="sm" onClick={(e) => openAt(e, inkMenu(swap))} />
      </div>
      {!ink.process && <TextInput label="Name" value={ink.name} validate={(v) => (v.trim() ? null : 'An ink needs a name: it names its layer and plate.')} onCommit={(v) => doc.transact(`Rename ${ink.name}`, (x) => mapInk(x, ink.id, (k) => ({ ...k, name: v.trim() })))} />}
      {ink.process && <p className={i.note}>Its colour changes only the view and the PNG; the separation stays CMYK.</p>}
      <div className={i.group}>
        <div className={s.curveHead}>
          <span className="lbl">Transfer curve</span>
          <span className={i.grow} />
          {!isIdentity(ink.curve) && (
            <button type="button" className={s.reset} onClick={() => doc.transact(`Reset the ${ink.name} curve`, (x) => mapInk(x, ink.id, (k) => ({ ...k, curve: [[0, 0], [1, 1]] })))}>
              Straight
            </button>
          )}
        </div>
        <Curve doc={doc} ink={ink} />
      </div>
      {!ink.process && (
        <div className={s.editorFoot}>
          <span className={i.note}>{d.inks.length < 2 ? 'The last ink stays.' : ''}</span>
          <IconButton icon="delete" label={d.inks.length < 2 ? 'The last ink stays' : `Remove ${ink.name}`} size="sm" disabled={d.inks.length < 2} onClick={() => setArming(true)} />
        </div>
      )}
    </div>
  );
}

/** the shared ink list every spot ink comes from, if one does */
function libraryOf(inks: Ink[]): string | null {
  const lib = LIBRARIES.find(({ id }) => inks.every((k) => INKS[id].some((x) => toHex(x.oklch) === toHex(k.colour))));
  return lib?.label ?? null;
}

export function InksModule({ doc, d, plateOf }: { doc: Doc; d: HalftoneDoc; plateOf: PlateOf }) {
  // which ink's settings are open is view state: it stays open across a tool switch
  const openId = useView().curve;
  const setOpen = (curve: string | null) => patchView({ curve });
  const from = inksFrom.use();
  const spot = d.mode === 'spot';
  const overlap = overlapOf(d);
  const shared = sharedScreen(d);
  const full = d.inks.length >= LIMIT.spot;
  const fromShown = from && d.inks.every((k) => from.swatches.some((w) => toHex(w.colour) === toHex(k.colour)));
  const library = fromShown ? null : libraryOf(d.inks);
  const visible = d.inks.filter((k) => k.visible).length;
  return (
    <Module
      title="Inks"
      sub={visible === d.inks.length ? plural(d.inks.length, 'plate') : `${visible} of ${plural(d.inks.length, 'plate')}`}
      actions={
        spot && (
          <IconButton icon="add" label={full ? `Spot inks stop at ${LIMIT.spot}` : 'Add a spot ink'} size="sm" disabled={full} onClick={(e) => openAt(e, inkMenu((name, c) => addInk(doc, name, c)))} />
        )
      }
    >
      <div className={i.stack}>
        <Segmented options={MODES} value={d.mode} onChange={(m) => setMode(doc, m)} />
        {spot && (
          <div className={i.row}>
            <span className={cx('lbl', i.lab)}>Inks from</span>
            <button type="button" className={s.from} aria-haspopup="menu" onClick={(e) => openAt(e, paletteMenu())}>
              <SwatchStrip colors={(fromShown ? from.swatches.map((w) => w.colour) : d.inks.map((k) => k.colour)).map(cssColor)} height={14} className={s.strip} />
              <span className={s.fromName}>{fromShown ? from.name : (library ?? 'Picked by hand')}</span>
              <Icon name="unfold_more" size={16} />
            </button>
          </div>
        )}
        <div>
          <div className={cx(s.row, s.headRow)} aria-hidden="true">
            <span />
            <span className="lbl">Plate</span>
            <span />
            <span className="lbl">Ink</span>
            <span className={cx('lbl', s.angleHead)}>Angle</span>
            <span />
          </div>
          {d.inks.map((ink, n) => (
            <div key={ink.id}>
              <InkRow doc={doc} d={d} ink={ink} n={n} plate={plateOf(ink.id)} open={openId === ink.id} onOpen={() => setOpen(openId === ink.id ? null : ink.id)} />
              {openId === ink.id && <InkEditor doc={doc} d={d} ink={ink} />}
            </div>
          ))}
        </div>
        {shared && (
          <p className={i.warn} role="status">
            {shared[0].name} and {shared[1].name} are on the same screen, so their dots print on top of each other. Turn one of them by 15° or 30°.
          </p>
        )}
        <div className={cx(i.group, i.rule)}>
          <Segmented label="Overlap" options={OVERLAPS} value={overlap} disabled={!spot} onChange={(o) => doc.transact(o === 'knockout' ? 'Knock out under each ink' : 'Overprint the inks', (x) => ({ ...x, overlap: o }))} />
          <p className={i.note}>
            {!spot ? 'CMYK always overprints: it builds its colours that way.' : overlap === 'overprint' ? 'Where inks meet they multiply, as transparent ink does.' : 'Each ink clears the ones before it, and its plate is cut to match.'}
          </p>
        </div>
      </div>
    </Module>
  );
}
