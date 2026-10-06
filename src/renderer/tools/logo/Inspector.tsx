// The inspector's lockup and colour groups (spec §5): Lockups, Proportions, Versions, Clearspace.
// Every value is typable and each change is one history step; fix() keeps the document valid.
import { cssColor } from '../../../shared/color/index.ts';
import { layoutLockup, spaceUnit } from '../../../shared/logo/layout.ts';
import { ALIGNS, sideBySide, type Align } from '../../../shared/logo/types.ts';
import { ColorField, IconButton, InfoTip, InspectorGroup, InspectorRow, menu, Segmented, Slider, Tooltip, useDocColour, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { displayName } from '../common/names.ts';
import { paletteMenu, useReadAhead } from '../common/palettes.ts';
import { copyProportions, resetProportions, select, toggleLockup, type Doc } from './actions.ts';
import { available, fix, KIND_LABEL, KIND_WHERE, LIMIT, mapLockup, twoParts, VERSION_LABEL, VERSIONS, type Lockup, type LockupKind, type LogoDoc, type Part, type Version } from './doc.ts';
import { palette } from './view-state.ts';
import s from './Inspector.module.css';

const ALIGN_LABEL: Record<Align, string> = { cap: 'Cap', baseline: 'Baseline', center: 'Centre', top: 'Top', bottom: 'Bottom', start: 'Left', end: 'Right' };
const ALIGN_TIP: Partial<Record<Align, string>> = {
  cap: 'The icon centred on the wordmark’s capitals',
  baseline: 'The icon standing on the wordmark’s baseline',
  center: 'The icon centred on the whole wordmark',
};

// a missing part is drawn as a stand-in in a lockup's diagram: a square mark, a name four caps long
const STAND_IN: Record<'icon' | 'wordmark', Part> = {
  icon: { svg: '<svg/>', png: null, name: '', box: { x: 0, y: 0, w: 1, h: 1 } },
  wordmark: { svg: '<svg/>', png: null, name: '', box: { x: 0, y: 0, w: 3.4, h: 1 }, type: { capTop: 0, baseline: 0.78 } },
};

/** the lockup's arrangement drawn from its own geometry: the icon solid, the wordmark's cap band lighter */
function Diagram({ d, lockup }: { d: LogoDoc; lockup: Lockup }) {
  const parts = { icon: d.icon ?? STAND_IN.icon, wordmark: d.wordmark ?? STAND_IN.wordmark };
  const lay = layoutLockup(parts, lockup);
  const k = Math.min(30 / Math.max(lay.w, 1e-6), 16 / Math.max(lay.h, 1e-6));
  const [ox, oy] = [(34 - lay.w * k) / 2, (20 - lay.h * k) / 2];
  const wm = lay.wordmark;
  const band = wm && parts.wordmark.type ? parts.wordmark.type : null;
  const wk = wm ? wm.h / parts.wordmark.box.h : 1;
  return (
    <svg className={s.diagram} width="34" height="20" viewBox="0 0 34 20" aria-hidden>
      {lay.icon && <rect x={ox + lay.icon.x * k} y={oy + lay.icon.y * k} width={lay.icon.w * k} height={lay.icon.h * k} rx="1.5" />}
      {wm && (
        <rect
          className={s.word}
          x={ox + wm.x * k}
          y={oy + (wm.y + (band ? (band.capTop - parts.wordmark.box.y) * wk : 0)) * k}
          width={wm.w * k}
          height={(band ? (band.baseline - band.capTop) * wk : wm.h) * k}
          rx="1"
        />
      )}
    </svg>
  );
}

/** one lockup's row: pick it (the row), turn it on or off (the eye) */
export function LockupsGroup({ doc, d, edited }: { doc: Doc; d: LogoDoc; edited: LockupKind | null }) {
  const on = d.lockups.filter((l) => l.on && available(d, l.kind)).length;
  return (
    <InspectorGroup id="logo.lockups" title="Lockups" meta={`${on} on`}>
      <div className={s.lockups} role="radiogroup" aria-label="Lockup to edit">
        {d.lockups.map((l) => {
          const ok = available(d, l.kind);
          const shown = l.on && ok;
          const mine = l.kind === edited;
          const info = !ok
            ? `Needs ${!d.icon ? 'an icon' : 'a wordmark'}`
            : `${KIND_WHERE[l.kind]}${twoParts(l.kind) ? ` · ratio ${l.ratio.toFixed(2)} · gap ${l.gap.toFixed(2)}` : ''}`;
          return (
            <div key={l.kind} className={cx(s.lockup, mine && s.edited, !shown && s.off)} data-lockup={l.kind}>
              <button
                type="button"
                role="radio"
                aria-checked={mine}
                disabled={!ok}
                className={s.pick}
                onClick={() => (shown ? select(l.kind) : toggleLockup(doc, l.kind, true))}
              >
                <Diagram d={d} lockup={l} />
                <span className={s.lockName}>{KIND_LABEL[l.kind]}</span>
              </button>
              <Tooltip content={info}>
                <span className={s.where}>{KIND_WHERE[l.kind]}</span>
              </Tooltip>
              <IconButton
                icon={shown ? 'visibility' : 'visibility_off'}
                label={!ok ? info : shown ? `Hide ${KIND_LABEL[l.kind].toLowerCase()}` : `Show ${KIND_LABEL[l.kind].toLowerCase()}`}
                size="sm"
                disabled={!ok}
                onClick={() => toggleLockup(doc, l.kind, !shown)}
              />
            </div>
          );
        })}
      </div>
    </InspectorGroup>
  );
}

export function ProportionsGroup({ doc, d, lockup }: { doc: Doc; d: LogoDoc; lockup: Lockup | null }) {
  const kind = lockup?.kind ?? 'horizontal';
  const ratio = useDocNumber(doc, {
    label: `Change the ratio of ${KIND_LABEL[kind].toLowerCase()}`,
    key: `${kind}:ratio`,
    get: (x) => x.lockups.find((l) => l.kind === kind)?.ratio ?? 1,
    set: (x, v) => fix(mapLockup(x, kind, (l) => ({ ...l, ratio: v }))),
  });
  const gap = useDocNumber(doc, {
    label: `Change the gap of ${KIND_LABEL[kind].toLowerCase()}`,
    key: `${kind}:gap`,
    get: (x) => x.lockups.find((l) => l.kind === kind)?.gap ?? 0,
    set: (x, v) => fix(mapLockup(x, kind, (l) => ({ ...l, gap: v }))),
  });
  if (!lockup) return null;
  const two = twoParts(kind);
  const noType = !d.wordmark?.type;
  // without a cap height found, Cap and Baseline would only be Centre and Bottom again
  const aligns = ALIGNS[kind].filter((a) => !noType || (a !== 'cap' && a !== 'baseline')).map((value) => ({ value, label: ALIGN_LABEL[value], tip: ALIGN_TIP[value] }));
  const align = noType && lockup.align === 'cap' ? 'center' : noType && lockup.align === 'baseline' ? 'bottom' : lockup.align;
  const alone =
    kind === 'icon'
      ? 'The icon on its own has nothing to set against another part.'
      : d.icon
        ? 'The wordmark on its own takes the main lockup’s size, so its clearspace is in the same icon heights.'
        : 'The wordmark on its own: with no icon, its clearspace is in cap heights.';
  return (
    <InspectorGroup
      id="logo.proportions"
      title="Proportions"
      sub={KIND_LABEL[kind]}
      actions={
        two && (
          <>
            <IconButton icon="restart_alt" label="Back to the proposed proportions" size="sm" onClick={() => resetProportions(doc, kind)} />
            <IconButton icon="content_copy" label="Copy these proportions to every other two-part lockup, stacked and side by side" size="sm" onClick={() => copyProportions(doc, kind)} />
          </>
        )
      }
    >
      {two ? (
        <>
          <Slider
            label="Ratio"
            info={`The icon’s height over the wordmark’s ${noType ? 'artwork height (no cap height was found)' : 'cap height'}. Drag a corner of the icon on the artboard to size it by eye.`}
            min={LIMIT.ratio[0]}
            max={LIMIT.ratio[1]}
            step={0.01}
            unit="×"
            {...ratio}
          />
          <Slider label="Gap" info="Between the artworks, in icon heights." min={LIMIT.gap[0]} max={LIMIT.gap[1]} step={0.01} unit="×" {...gap} />
          <Segmented
            label="Align"
            info={sideBySide(kind) ? 'How the icon sits against the wordmark, top to bottom.' : 'How the icon and the wordmark line up, left to right.'}
            options={aligns}
            value={align}
            onChange={(align) => doc.transact(`Align ${KIND_LABEL[kind].toLowerCase()} by ${ALIGN_LABEL[align].toLowerCase()}`, (x) => mapLockup(x, kind, (l) => ({ ...l, align })))}
          />
        </>
      ) : (
        <p className={s.note}>
          Nothing to set for a single part.
          <InfoTip text={`${alone} Its clearspace and export size are set below.`} />
        </p>
      )}
    </InspectorGroup>
  );
}

const VERSION_SHORT: Record<Version, string> = {
  original: 'The artwork’s own colours',
  black: 'Every fill black, white ones cut out',
  white: 'Every fill white, white ones cut out',
  colour: 'Every fill the colour, white ones cut out',
  knockout: 'White on a field of the colour',
};

/** what a version paints, as a swatch: the chip is what it controls */
function Chip({ version, d }: { version: Version; d: LogoDoc }) {
  const colour = cssColor(d.colour);
  const style =
    version === 'black' ? { background: cssColor([0, 0, 0]) } : version === 'white' ? { background: cssColor([1, 0, 0]) } : version === 'colour' ? { background: colour } : version === 'knockout' ? { background: colour } : undefined;
  return <i className={cx(s.swatch, version === 'original' && s.original, version === 'knockout' && s.knock)} style={style} />;
}

/** which versions ship (a chip pressed = it exports), and the colour One colour and Knockout use */
export function VersionsGroup({ doc, d }: { doc: Doc; d: LogoDoc }) {
  const colour = useDocColour(doc, { label: 'Change the colour', key: 'colour', get: (x) => x.colour, set: (x, o) => ({ ...x, colour: o }) });
  const pal = palette.use();
  useReadAhead();
  const toggle = (v: Version, on: boolean) =>
    doc.transact(`${on ? 'Turn on' : 'Turn off'} ${VERSION_LABEL[v].toLowerCase()}`, (x) => fix({ ...x, versions: on ? [...x.versions, v] : x.versions.filter((y) => y !== v) }));
  const raster = !!(d.icon && !d.icon.svg) || !!(d.wordmark && !d.wordmark.svg);
  return (
    <InspectorGroup
      id="logo.versions"
      title="Versions"
      meta={`${d.versions.length} on`}
      actions={<InfoTip text="A pressed version goes into the sheet and every export. The switch in the bar chooses which one you look at." />}
    >
      <div className={s.chipsGrid} role="group" aria-label="Versions that are exported">
        {VERSIONS.map((v) => {
          const on = d.versions.includes(v);
          const last = on && d.versions.length === 1;
          return (
            <Tooltip key={v} content={last ? 'The last one stays on' : `${on ? 'In the export' : 'Not in the export'}: ${VERSION_SHORT[v]}`}>
              <button type="button" aria-pressed={on} disabled={last} className={cx(s.vchip, on && s.pressed)} onClick={() => toggle(v, !on)}>
                <Chip version={v} d={d} />
                {VERSION_LABEL[v]}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <InspectorRow
        label="Colour"
        info={`One colour and knockout use it. Every fill in the export is this colour itself, never a filter. In every version but the original, white inside the artwork is cut out, so a white detail on a dark shape stays a detail.${raster ? ' A PNG part takes it as a flat tint.' : ''}`}
      >
        <ColorField {...colour} name={displayName({ name: '', oklch: colour.value })} />
        <IconButton
          icon="palette"
          label="The colour from a Library palette"
          size="sm"
          onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), paletteMenu('logo'), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })}
        />
      </InspectorRow>
      {pal && (
        <div className={s.chips} role="group" aria-label={`Colours from ${pal.name}`}>
          <span className={s.from}>{pal.name}</span>
          {pal.swatches.map((w) => (
            <Tooltip key={w.id} content={`Use ${displayName(w)}`}>
              <button type="button" className={s.chip} aria-label={`Use ${displayName(w)}`} onClick={() => doc.transact(`Colour from ${displayName(w)}`, (x) => ({ ...x, colour: w.oklch }))}>
                <i data-colour style={{ background: cssColor(w.oklch) }} />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </InspectorGroup>
  );
}

const PADDINGS = [
  { value: 'clearspace' as const, label: 'Clearspace' },
  { value: 'tight' as const, label: 'Tight' },
];

export function ClearspaceGroup({ doc, d }: { doc: Doc; d: LogoDoc }) {
  const space = useDocNumber(doc, { label: 'Change the clearspace', key: 'clearspace', get: (x) => x.clearspace, set: (x, v) => fix({ ...x, clearspace: v }) });
  return (
    <InspectorGroup id="logo.clearspace" title="Clearspace" meta={`${d.clearspace.toFixed(2)} × ${spaceUnit(d)}`} defaultOpen={false}>
      <Slider label="Clearspace" info={`The room kept clear on every side, in ${spaceUnit(d)}s, the same for every lockup.`} min={LIMIT.clearspace[0]} max={LIMIT.clearspace[1]} step={0.05} precision={2} unit="×" {...space} />
      <Segmented
        label="Exports"
        info={d.exportPadding === 'tight' ? 'Exports are trimmed to the artwork; a knockout keeps its clearspace, as its field.' : 'Exports carry the clearspace as transparent padding.'}
        options={PADDINGS}
        value={d.exportPadding}
        onChange={(exportPadding) => doc.transact(exportPadding === 'tight' ? 'Export trimmed tight' : 'Export with clearspace', (x) => ({ ...x, exportPadding }))}
      />
    </InspectorGroup>
  );
}
