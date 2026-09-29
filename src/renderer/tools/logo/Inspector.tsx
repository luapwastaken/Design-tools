// The inspector's lockup and colour modules (spec §2): Lockups, Proportions, Versions, Clearspace.
// Every value is typable and each change is one history step; fix() keeps the document valid.
import { useMemo, type MouseEvent } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { layoutLockup, spaceUnit } from '../../../shared/logo/layout.ts';
import { ALIGNS, type Align } from '../../../shared/logo/types.ts';
import { shell } from '../../shell/core/index.ts';
import { ColorField, IconButton, menu, Module, Segmented, Slider, Toggle, Tooltip, useDocColour, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { displayName } from '../common/names.ts';
import { copyProportions, resetProportions, select, toggleLockup, type Doc } from './actions.ts';
import { available, fix, KIND_LABEL, KIND_WHERE, LIMIT, mapLockup, proposed, twoParts, VERSION_LABEL, VERSION_NOTE, VERSIONS, type Lockup, type LockupKind, type LogoDoc, type Part, type Version } from './doc.ts';
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
  const k = Math.min(40 / Math.max(lay.w, 1e-6), 22 / Math.max(lay.h, 1e-6));
  const [ox, oy] = [(48 - lay.w * k) / 2, (28 - lay.h * k) / 2];
  const wm = lay.wordmark;
  const band = wm && parts.wordmark.type ? parts.wordmark.type : null;
  const wk = wm ? wm.h / parts.wordmark.box.h : 1;
  return (
    <svg className={s.diagram} width="48" height="28" viewBox="0 0 48 28" aria-hidden>
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

export function LockupsModule({ doc, d, edited }: { doc: Doc; d: LogoDoc; edited: LockupKind | null }) {
  const ideas = useMemo(() => new Set(proposed(d).filter((l) => l.on).map((l) => l.kind)), [d.icon, d.wordmark]);
  const on = d.lockups.filter((l) => l.on && available(d, l.kind)).length;
  // only where the choice differs from the proposal: one the parts suit left off, or one added
  const tag = (l: Lockup): [string, string] | null =>
    l.on === ideas.has(l.kind) ? null : l.on ? ['Added', 'Not one the parts’ shapes suggest'] : ['Proposed', 'The parts’ shapes suit this one'];
  return (
    <Module title="Lockups" sub={`${on} on · ${ideas.size} proposed`}>
      <div className={s.lockups}>
        {d.lockups.map((l) => {
          const ok = available(d, l.kind);
          const needs = !ok ? `Needs ${!d.icon ? 'an icon' : 'a wordmark'}` : null;
          const mine = l.kind === edited;
          const t = ok ? tag(l) : null;
          const meta = needs ?? (twoParts(l.kind) ? `${KIND_WHERE[l.kind]} · ratio ${l.ratio.toFixed(2)} · gap ${l.gap.toFixed(2)}` : KIND_WHERE[l.kind]);
          return (
            <div key={l.kind} className={cx(s.lockup, mine && s.edited, !ok && s.off)}>
              <Diagram d={d} lockup={l} />
              <div className={s.lockText}>
                <Toggle label={KIND_LABEL[l.kind]} checked={l.on && ok} disabled={!ok} onChange={(v) => toggleLockup(doc, l.kind, v)} className={s.toggle} />
                <Tooltip content={meta} overflowOnly>
                  <span className={s.meta}>{meta}</span>
                </Tooltip>
              </div>
              {t && (
                <Tooltip content={t[1]}>
                  <span className={cx('lbl', s.tag)}>{t[0]}</span>
                </Tooltip>
              )}
              <IconButton icon="edit" label={l.on && ok ? `Edit ${KIND_LABEL[l.kind].toLowerCase()}` : 'Turn it on to edit it'} size="sm" latched={mine} disabled={!l.on || !ok} onClick={() => select(l.kind)} />
            </div>
          );
        })}
      </div>
    </Module>
  );
}

export function ProportionsModule({ doc, d, lockup }: { doc: Doc; d: LogoDoc; lockup: Lockup | null }) {
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
  return (
    <Module
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
        <div className={s.stack}>
          <div className={s.group}>
            <Slider label="Ratio" min={LIMIT.ratio[0]} max={LIMIT.ratio[1]} step={0.01} unit="×" {...ratio} />
            <Slider label="Gap" min={LIMIT.gap[0]} max={LIMIT.gap[1]} step={0.01} unit="×" {...gap} />
          </div>
          <Segmented label="Align" options={aligns} value={align} onChange={(align) => doc.transact(`Align ${KIND_LABEL[kind].toLowerCase()} by ${ALIGN_LABEL[align].toLowerCase()}`, (x) => mapLockup(x, kind, (l) => ({ ...l, align })))} />
          <p className={s.note}>
            Ratio is the icon’s height over the wordmark’s {noType ? 'artwork height (no cap height was found)' : 'cap height'}; the gap is in icon heights, artwork to artwork. Drag a corner of the icon to size it by eye.
          </p>
        </div>
      ) : (
        <p className={s.note}>
          {kind === 'icon' ? 'The icon on its own has nothing to set against another part.' : d.icon ? 'The wordmark on its own takes the main lockup’s size, so its clearspace is in the same icon heights.' : 'The wordmark on its own: with no icon, its clearspace is in cap heights.'} Its clearspace and export size are below.
        </p>
      )}
    </Module>
  );
}

export function VersionsModule({ doc, d }: { doc: Doc; d: LogoDoc }) {
  const colour = useDocColour(doc, { label: 'Change the colour', key: 'colour', get: (x) => x.colour, set: (x, o) => ({ ...x, colour: o }) });
  const pal = palette.use();
  const toggle = (v: Version, on: boolean) =>
    doc.transact(`${on ? 'Turn on' : 'Turn off'} ${VERSION_LABEL[v].toLowerCase()}`, (x) => fix({ ...x, versions: on ? [...x.versions, v] : x.versions.filter((y) => y !== v) }));
  const raster = !!(d.icon && !d.icon.svg) || !!(d.wordmark && !d.wordmark.svg);
  const palettes = (e: MouseEvent<HTMLButtonElement>) => {
    const groups = (shell.getState().library?.collections ?? []).map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => i.kind === 'palette') })).filter((g) => g.items.length);
    const items: MenuItem[] = groups.length
      ? groups.flatMap((g) => [{ header: g.name }, ...g.items.map((ref) => ({ label: ref.name, onSelect: () => void shell.sendItem(ref, 'logo') }))])
      : [{ label: 'No palettes in the Library yet', disabled: true }];
    menu.open(e.currentTarget.getBoundingClientRect(), items, { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });
  };
  return (
    <Module title="Versions" sub={`${d.versions.length} on`} actions={<IconButton icon="palette" label="The colour from a Library palette" size="sm" onClick={palettes} />}>
      <div className={s.versions}>
        {VERSIONS.map((v) => {
          const on = d.versions.includes(v);
          const last = on && d.versions.length === 1;
          return (
            <div key={v} className={s.version}>
              <Toggle label={VERSION_LABEL[v]} checked={on} disabled={last} onChange={(x) => toggle(v, x)} className={s.toggle} />
              <span className={s.meta}>{last ? 'The last one stays on' : VERSION_NOTE[v]}</span>
            </div>
          );
        })}
      </div>
      <div className={cx(s.group, s.rule)}>
        <ColorField {...colour} name={displayName({ name: '', oklch: colour.value })} />
        {pal && (
          <div className={s.chips} role="group" aria-label={`Colours from ${pal.name}`}>
            <span className={cx('lbl', s.from)}>{pal.name}</span>
            {pal.swatches.map((w) => (
              <Tooltip key={w.id} content={`Use ${displayName(w)}`}>
                <button type="button" className={s.chip} aria-label={`Use ${displayName(w)}`} onClick={() => doc.transact(`Colour from ${displayName(w)}`, (x) => ({ ...x, colour: w.oklch }))}>
                  <i style={{ background: cssColor(w.oklch) }} />
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <p className={s.note}>
          One colour and knockout use it. Every fill in the export is this colour itself, never a filter. In every version but the original, white inside the artwork is cut out, so a white detail on a dark shape stays a detail.{raster ? ' A PNG part takes it as a flat tint.' : ''}
        </p>
      </div>
    </Module>
  );
}

const PADDINGS = [
  { value: 'clearspace' as const, label: 'Clearspace' },
  { value: 'tight' as const, label: 'Tight' },
];

export function ClearspaceModule({ doc, d }: { doc: Doc; d: LogoDoc }) {
  const space = useDocNumber(doc, { label: 'Change the clearspace', key: 'clearspace', get: (x) => x.clearspace, set: (x, v) => fix({ ...x, clearspace: v }) });
  return (
    <Module title="Clearspace" readout={`${d.clearspace.toFixed(2)} × ${spaceUnit(d)}`}>
      <div className={s.stack}>
        <Slider label="Clearspace" min={LIMIT.clearspace[0]} max={LIMIT.clearspace[1]} step={0.05} precision={2} unit="×" {...space} />
        <Segmented
          label="Exports"
          options={PADDINGS}
          value={d.exportPadding}
          onChange={(exportPadding) => doc.transact(exportPadding === 'tight' ? 'Export trimmed tight' : 'Export with clearspace', (x) => ({ ...x, exportPadding }))}
        />
        <p className={s.note}>
          The room kept clear on every side, in {spaceUnit(d)}s, the same for every lockup. {d.exportPadding === 'tight' ? 'Exports are trimmed to the artwork; a knockout keeps it, as its field.' : 'Exports carry it as transparent padding.'}
        </p>
      </div>
    </Module>
  );
}

