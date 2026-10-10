// Tab 3, Light zones: each ramp's colour broken into the zones a painter reads on a form (highlight,
// light, halftone | core shadow, reflected light, cast shadow | rim), lit by four named lights. Left,
// the grid, one row per ramp; right, a ball on a ground painted only with the selected row's zones, and
// the four lights. The Key and Fill are the palette's light and shadow (the Light row's pair), so
// choosing a preset here is the Light row's one undo step; the rest of the lights are view state.
// The maths is shared/palette/zones.ts; what is shown and the preview's picture are light-zones.ts.
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cssColor, rgb255, toHex, type Oklch } from '../../../shared/color/index.ts';
import { valueOf } from '../../../shared/color/value.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import { ZONES, type ZoneId } from '../../../shared/palette/zones.ts';
import { cx } from '../../ui/cx.ts';
import { Button, ColorField, InspectorGroup, InspectorRow, KelvinField, Select, Slider, toast, Tooltip, useDocColour } from '../../ui/index.ts';
import { GreyscaleButton } from '../common/Greyscale.tsx';
import { displayName } from '../common/names.ts';
import { propose, proposals, ZONES_LABEL } from './proposals.ts';
import { paletteFull, select, selected, type Doc } from './actions.ts';
import { baseOf, type IllustrationDoc } from './doc.ts';
import { LIT_VIEW } from './Light.tsx';
import { BACKDROP, BANDS, drawRing, PREVIEW, readout, renderZones, ringOf, STRENGTH_NAMES, STRENGTH_RANGES, ZONE_ID, ZONE_TEXT, zoneMap, zoneName, zoneRig, zoneRows, type ZoneRow } from './light-zones.ts';
import { chooseLight, lightBinding } from './LightRow.tsx';
import { proofOf, PROOFS, type Proof } from './proof.ts';
import { LIGHTS, sceneLight } from './scene.ts';
import { patchView, shaped, type IllustrationView } from './view-state.ts';
import s from './LightZones.module.css';

type Hot = { row: string; zone: ZoneId } | null;

/** below this value a swatch is near-black: it gets a stronger edge and shows its value, so the two families can be told apart */
const DARK = 0.1;
const HEX = (o: Oklch) => toHex(o).toUpperCase();
const val = (o: Oklch) => valueOf(o).toFixed(2);
const HELD = 'The light and shadow families would have met in value, so this colour was solved again at a value that keeps them apart, keeping its hue.';

export function ZonesTab({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const group = selected(d, v.selected)?.group;
  const rig = useMemo(() => zoneRig(d, v, group), [d.ramps, d.scene, group, v.zoneStrengths, v.zoneRim, v.zoneGround]);
  const rows = useMemo(() => zoneRows(d, rig), [d.ramps, d.swatches, rig]);
  const [hot, setHot] = useState<Hot>(null);
  const on = rows.find((r) => r.id === group) ?? rows[0];
  const light = shaped(v.preview, LIT_VIEW);

  const pickRow = (r: ZoneRow) => select(baseOf(d, r.id)?.id ?? null);
  // colours offered to the palette as proposals; one set gathers them, and a colour already offered is not offered twice
  const offer = (r: ZoneRow, zones: ZoneId[]) => {
    if (paletteFull(d)) return;
    const have = proposals.get()?.label === ZONES_LABEL ? proposals.get()!.items : [];
    const fresh = zones.filter((z) => !have.some((p) => p.name === zoneName(r.name, z) && p.oklch.every((x, i) => x === r.result.zones[z][i])));
    if (!fresh.length) return void toast.show({ icon: 'info', message: 'Already offered: keep or discard it in the Ramps panel.' });
    propose(ZONES_LABEL, fresh.map((z) => r.result.zones[z]), fresh.map((z) => zoneName(r.name, z)), { materials: fresh.map(() => r.material) });
    toast.show({ icon: 'info', message: `Offered ${fresh.length === 1 ? zoneName(r.name, fresh[0]) : `all of ${r.name}`}. Keep or discard it in the Ramps panel.` });
  };
  // the grid does not redraw as the pointer moves between cells: its handlers are the latest ones, behind stable wrappers
  const latest = useRef({ pickRow, offer });
  latest.current = { pickRow, offer };
  const addRow = useCallback((r: ZoneRow) => latest.current.offer(r, [...ZONES]), []);
  const addCell = useCallback((r: ZoneRow, z: ZoneId) => {
    latest.current.pickRow(r);
    latest.current.offer(r, [z]);
  }, []);
  const pick = useCallback((r: ZoneRow) => latest.current.pickRow(r), []);
  const point = useCallback((h: Hot) => setHot(h), []);
  const shown = (hot && rows.find((r) => r.id === hot.row)) || on;

  return (
    <div className={s.tab}>
      <div className={s.layout}>
        <section className={s.main} aria-label="Zones of each ramp">
          <div className={s.bar}>
            <Button size="xs" latched={v.zoneValues} tooltip="Show each colour’s value, the grey it becomes" onClick={() => patchView({ zoneValues: !v.zoneValues })}>
              Values
            </Button>
            <span className={s.seen}>
              <span className={s.lab}>Seen as</span>
              <Select className={s.seenSel} options={PROOFS} value={v.proof} menuWidth={160} onChange={(proof: Proof) => patchView({ proof })} />
            </span>
            <GreyscaleButton />
          </div>
          {rows.length === 0 ? (
            <p className={s.hint}>Each ramp gets a row here. Make a ramp from a colour to see its light and shadow zones.</p>
          ) : (
            <div className={s.scroll}>
              <div className={s.grid}>
                <div className={s.heads}>
                  <div className={s.line} aria-hidden="true">
                    {BANDS.map((b, i) => (
                      <span key={b.id} className={s.band} style={{ gridColumn: COLUMNS[i] }}>
                        {b.label}
                      </span>
                    ))}
                  </div>
                  <div className={s.line}>
                    {ORDER.map((z, i) => (
                      <span key={z} className={s.head} style={{ gridColumn: col(i) }}>
                        <b>{ZONE_TEXT[z].name}</b>
                        <small>{ZONE_TEXT[z].src}</small>
                      </span>
                    ))}
                  </div>
                </div>
                {rows.map((r) => (
                  <Row key={r.id} r={r} on={r === on} proof={v.proof} values={v.zoneValues} pick={pick} addRow={addRow} addCell={addCell} point={point} />
                ))}
              </div>
            </div>
          )}
        </section>
        <div className={s.side}>
          <section className={s.preview} aria-label="Lit preview">
            <h3 className={s.title}>
              Lit preview <span className={s.of}>{shown?.name ?? ''}</span>
            </h3>
            {shown && <Preview row={shown} hot={hot && shown.id === hot.row ? hot.zone : null} azimuth={light.azimuth} elevation={light.elevation} proof={v.proof} />}
            <p className={s.caption}>{caption(hot && shown?.id === hot.row ? hot.zone : null, shown)}</p>
          </section>
          <Lights doc={doc} d={d} v={v} group={group} />
        </div>
      </div>
    </div>
  );
}

/** the columns, left to right: the grid skips a narrow gutter after each family */
const ORDER: ZoneId[] = BANDS.flatMap((b) => b.zones);
const COLUMNS = ['2 / 5', '6 / 9', '10'];
const col = (i: number) => (i < 3 ? i + 2 : i < 6 ? i + 3 : 10);

type RowProps = {
  r: ZoneRow;
  on: boolean;
  proof: Proof;
  values: boolean;
  pick(r: ZoneRow): void;
  addRow(r: ZoneRow): void;
  addCell(r: ZoneRow, z: ZoneId): void;
  point(h: Hot): void;
};

/** one ramp's row: it redraws only when its zones, the proof or the Values switch change, not as the pointer moves along the grid */
const Row = memo(function Row({ r, on, proof, values, pick, addRow, addCell, point }: RowProps) {
  return (
    <div role="group" aria-label={r.name} className={cx(s.line, s.row, on && s.on)}>
      <div className={s.rowh}>
        <button type="button" className={s.name} aria-pressed={on} onClick={() => pick(r)}>
          {r.name}
        </button>
        <span className={s.material}>{MATERIALS.find((m) => m.id === r.material)?.label}</span>
        <Button size="xs" variant="ghost" icon="add" tooltip={`Offer all seven colours of ${r.name} to the palette`} onClick={() => addRow(r)}>
          Add row
        </Button>
      </div>
      {ORDER.map((z, i) => {
        const o = r.result.zones[z];
        const held = r.result.held.includes(z);
        const dark = valueOf(o) < DARK;
        return (
          <button
            key={z}
            type="button"
            className={s.cell}
            data-zone={z}
            style={{ gridColumn: col(i) }}
            aria-label={`${zoneName(r.name, z)}, ${HEX(o)}, value ${val(o)}${held ? ', held' : ''}. Add to the palette`}
            onClick={() => addCell(r, z)}
            onPointerEnter={() => point({ row: r.id, zone: z })}
            onPointerLeave={() => point(null)}
            onFocus={() => point({ row: r.id, zone: z })}
            onBlur={() => point(null)}
          >
            <i className={s.sw} data-colour="" data-dark={dark || undefined} style={{ background: cssColor(proofOf(o, proof)) }} />
            <span className={s.hex}>
              {HEX(o)}
              {held && (
                <Tooltip content={HELD}>
                  <span className={s.held}>held</span>
                </Tooltip>
              )}
            </span>
            {(values || dark) && <span className={s.val}>value {val(o)}</span>}
          </button>
        );
      })}
      <p className={s.split}>{readout(r.result.split)}</p>
    </div>
  );
});

/** what is under the preview: the zone pointed at, named with its colour, or what to do */
function caption(zone: ZoneId | null, r: ZoneRow | undefined) {
  if (!zone || !r) return r ? 'Point at a swatch to see where it sits on the ball. Click one to offer it to the palette.' : '';
  return (
    <>
      <b>{ZONE_TEXT[zone].name}</b> <span className={s.mono}>{HEX(r.result.zones[zone])}</span>
      <br />
      {ZONE_TEXT[zone].hint}
    </>
  );
}

/** how far the zones not pointed at give way to a mid grey, so the one that is stands out whatever its value */
const MUTE = 0.75;
const GREY = 128;

/** the ball on its ground, every pixel one of the row's seven colours (the ground is its Light); with a zone pointed at, the rest give way to grey and it is ringed */
function Preview({ row, hot, azimuth, elevation, proof }: { row: ZoneRow; hot: ZoneId | null; azimuth: number; elevation: number; proof: Proof }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    image.current ??= new ImageData(PREVIEW, PREVIEW);
    const map = zoneMap({ azimuth, elevation }, MATERIALS.find((m) => m.id === row.material)?.light.sharp ?? 1);
    const z = row.result.zones;
    const colours = [BACKDROP, ...ZONES.map((id) => z[id]), z.light].map((o, i) => {
      const c = rgb255(proofOf(o, proof));
      return hot && i > 0 && i !== ZONE_ID[hot] ? c.map((x) => x + (GREY - x) * MUTE) : c;
    });
    renderZones(image.current.data, map, colours);
    if (hot) drawRing(image.current.data, ringOf(map, ZONE_ID[hot]));
    ctx.putImageData(image.current, 0, 0);
  }, [row.result, row.material, azimuth, elevation, proof, hot]);
  return <canvas ref={ref} width={PREVIEW} height={PREVIEW} className={s.ball} data-colour="" role="img" aria-label={`A ball on a ground painted with the seven zone colours of ${row.name}`} />;
}

const LAMP_INFO: Record<(typeof STRENGTH_NAMES)[number], string> = {
  key: 'How strong the sun or lamp is next to the fill. Light stays the local colour whatever it is.',
  fill: 'How much sky there is in the shadows. More fill lifts every shadow.',
  bounce: 'How much light comes back off the ground into the shadow side.',
  rim: 'How strong the light from behind is.',
};

/** the four lights; Key and Fill write the palette's light pair, the rest are the view's */
function Lights({ doc, d, v, group }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; group: string | undefined }) {
  const { preset, mixed } = sceneLight(d, group);
  const value = preset?.id ?? (mixed ? 'mixed' : 'custom');
  const options = [...LIGHTS.map((l) => ({ value: l.id, label: l.label })), ...(preset ? [] : [{ value, label: mixed ? 'Mixed' : 'Custom' }])];
  const key = useDocColour(doc, lightBinding('light', 'key colour', group));
  const fill = useDocColour(doc, lightBinding('shadow', 'fill colour', group));
  const strength = (i: number) => (
    <Slider
      label="Strength"
      info={LAMP_INFO[STRENGTH_NAMES[i]]}
      value={v.zoneStrengths[i]}
      min={STRENGTH_RANGES[i][0]}
      max={STRENGTH_RANGES[i][1]}
      step={0.01}
      precision={2}
      onChange={(x) => patchView({ zoneStrengths: v.zoneStrengths.map((old, j) => (j === i ? x : old)) })}
    />
  );
  const name = (o: Oklch) => displayName({ name: '', oklch: o });
  return (
    <div className={s.lights}>
      <p className={s.hint}>A light’s colour sets its tint; its strength sets how bright it is.</p>
      <InspectorRow label="Light preset" info="Sets the key and the fill together, as the Light row does, and the four strengths with them.">
        <Select options={options} value={value} onChange={(id) => chooseLight(doc, id)} />
      </InspectorRow>
      <InspectorGroup title="Key" sub="sun or lamp" id="illustration.zones.key">
        <InspectorRow label="Colour">
          <ColorField {...key} name={name(key.value)} />
        </InspectorRow>
        <InspectorRow label="Kelvin" info="Type a colour temperature: 2700 is a warm lamp, 6500 is neutral, 10000 is blue sky. The key takes the colour a light of that temperature gives.">
          <KelvinField {...key} />
        </InspectorRow>
        {strength(0)}
      </InspectorGroup>
      <InspectorGroup title="Fill" sub="sky in the shadows" id="illustration.zones.fill">
        <InspectorRow label="Colour">
          <ColorField {...fill} name={name(fill.value)} />
        </InspectorRow>
        {strength(1)}
      </InspectorGroup>
      <InspectorGroup title="Bounce" sub="off the ground or a wall" id="illustration.zones.bounce">
        <InspectorRow label="Ground" info="The colour of what the light bounces off. A green lawn gives a green bounce in the shadows.">
          <ColorField value={v.zoneGround} name={name(v.zoneGround)} onChange={(zoneGround) => patchView({ zoneGround })} />
        </InspectorRow>
        {strength(2)}
      </InspectorGroup>
      <InspectorGroup title="Rim" sub="from behind" id="illustration.zones.rim">
        <InspectorRow label="Colour">
          <ColorField value={v.zoneRim ?? key.value} name={v.zoneRim ? name(v.zoneRim) : 'Same as key'} onChange={(zoneRim) => patchView({ zoneRim })} />
          {v.zoneRim && (
            <Button size="xs" variant="ghost" onClick={() => patchView({ zoneRim: null })}>
              Same as key
            </Button>
          )}
        </InspectorRow>
        {strength(3)}
      </InspectorGroup>
    </div>
  );
}
