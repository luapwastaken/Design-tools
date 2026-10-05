// Palette (spec §3, §5 q4): retro presets, any Library palette, or colours taken from the image,
// matched in OKLab. Here you pick colours (leave one out, bring it back) and order them, which the
// gradient map and the indexed PNG follow; the colours themselves are edited in Design.
import { useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { shell } from '../../shell/core/index.ts';
import { Button, Icon, IconButton, InfoTip, InspectorGroup, InspectorRow, menu, NumberField, SwatchStrip, Tooltip, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { libraryPalettes, paletteMenu, useReadAhead } from '../common/palettes.ts';
import { editInDesign, extract, sortByLightness, toggleColour, usePreset, type Doc } from './actions.ts';
import { LIMIT, moveColour, used, type DitherDoc } from './doc.ts';
import { PRESETS } from './looks.ts';
import { patchView, under, useView } from './view-state.ts';
import s from './Palette.module.css';
import i from './Inspector.module.css';

/** internal reorders carry this type (spec §9), so OS files dropped here still go to onFiles */
const REORDER_MIME = 'application/x-designtools-reorder';
/** past this many colours the chips get small, and the grid scrolls past a few rows, so Tone and Export stay in reach */
const DENSE = 48;

const openAt = (e: MouseEvent<HTMLButtonElement>, items: MenuItem[]) => menu.open(e.currentTarget.getBoundingClientRect(), items, { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });

/** the retro presets, then the Library's palettes by collection, each with its colours; a Library one arrives as Send to would bring it */
function sourceMenu(doc: Doc, d: DitherDoc): MenuItem[] {
  const current = d.paletteSource;
  return [
    { header: 'Retro' },
    ...PRESETS.map((p) => ({ label: p.name, strip: p.colours.map(cssColor), hint: `${p.colours.length}`, checked: current.kind === 'preset' && current.id === p.id, onSelect: () => usePreset(doc, p.name, p.id, p.colours) })),
    ...(libraryPalettes(shell.getState().library).length ? [] : [{ header: 'Library' }]),
    ...paletteMenu('dither', (ref) => current.kind === 'library' && current.id === ref.id),
  ];
}

export function PaletteModule({ doc, d, frame }: { doc: Doc; d: DitherDoc; frame: number }) {
  const v = useView();
  const lit = under.use();
  const [drag, setDrag] = useState<{ from: number; at: number | null } | null>(null);
  const [focus, setFocus] = useState(0);
  const colours = d.palette.colours;
  const on = used(d).length;
  // the result counts in the colours that are on: the pointer's index is the nth of them
  const usedAt = colours.map((_, n) => (colours[n].on ? colours.slice(0, n).filter((c) => c.on).length : -1));
  const hex = (n: number) => toHex(colours[n].oklch).toUpperCase();
  useReadAhead();

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
    if (by === undefined) return;
    e.preventDefault();
    const to = Math.min(colours.length - 1, Math.max(0, focus + by));
    if (e.altKey && Number.isFinite(by)) {
      if (to === focus) return;
      doc.transact(`Move ${hex(focus)}`, (x) => moveColour(x, focus, by > 0 ? to + 1 : to));
    }
    setFocus(to);
    (e.currentTarget.querySelector(`[data-index="${to}"]`) as HTMLElement | null)?.focus();
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return; // files: the shell routes them to onFiles
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const chip = (e.target as Element).closest<HTMLElement>('[data-index]');
    if (!chip) return;
    const r = chip.getBoundingClientRect();
    const at = Number(chip.dataset.index) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
    if (at !== drag.at) setDrag({ ...drag, at });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return;
    e.preventDefault();
    const { from, at } = drag;
    if (at !== null && at !== from && at !== from + 1) doc.transact(`Move ${hex(from)}`, (x) => moveColour(x, from, at));
    setDrag(null);
  };

  return (
    <InspectorGroup id="dither.palette"
      title="Palette"
      meta={on === colours.length ? plural(on, 'colour') : `${on} of ${colours.length} on`}
      actions={
        <>
          <InfoTip text="Click a colour to leave it out. Drag it, or Alt and an arrow, to reorder: the gradient map and the indexed PNG follow this order." />
          <IconButton icon="sort" label="Sort dark to light" size="sm" onClick={() => sortByLightness(doc)} />
          <IconButton icon="open_in_new" label="Edit the colours in Design" size="sm" onClick={() => void editInDesign(d)} />
        </>
      }
    >
      <div className={i.stack}>
        <button type="button" className={s.from} aria-haspopup="menu" aria-label={`Palette: ${d.palette.name}`} onClick={(e) => openAt(e, sourceMenu(doc, d))}>
          <SwatchStrip colors={colours.filter((c) => c.on).map((c) => cssColor(c.oklch))} height={14} className={s.strip} />
          <Tooltip content={d.palette.name} overflowOnly>
            <span className={s.name}>{d.palette.name || 'Untitled'}</span>
          </Tooltip>
          <span className="lbl">{d.paletteSource.kind === 'extract' ? 'Image' : d.paletteSource.kind === 'library' ? 'Library' : 'Retro'}</span>
          <Icon name="unfold_more" size={16} />
        </button>
        <div className={i.group}>
          <div className={s.chips} data-dense={colours.length > DENSE ? '' : undefined} role="toolbar" aria-label="Colours" onKeyDown={onKey} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && drag && setDrag({ ...drag, at: null })}>
            {colours.map((c, n) => {
              const insert = drag?.at === n ? 'before' : drag?.at === colours.length && n === colours.length - 1 ? 'after' : null;
              return (
                <Tooltip key={n} content={`${c.on ? `${usedAt[n] + 1} · ` : ''}${hex(n)}${c.on ? ' · click to leave it out' : ' · left out, click to use it'}`}>
                  <button
                    type="button"
                    data-index={n}
                    aria-pressed={c.on}
                    aria-label={`${hex(n)}${c.on ? `, colour ${usedAt[n] + 1}` : ', left out'}`}
                    tabIndex={n === Math.min(focus, colours.length - 1) ? 0 : -1}
                    draggable
                    className={cx(s.chip, !c.on && s.off, lit !== null && usedAt[n] === lit && s.lit, drag?.from === n && s.dragged, insert === 'before' && s.before, insert === 'after' && s.after)}
                    onFocus={() => setFocus(n)}
                    onClick={() => toggleColour(doc, n)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(REORDER_MIME, `${n}`);
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ from: n, at: null });
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <i className={s.colour} style={{ background: cssColor(c.oklch) }} />
                    <span className={s.num}>{c.on ? usedAt[n] + 1 : '–'}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
        <InspectorRow label="Colours" info={d.source ? `The ${v.extract} colours that best cover ${d.source.name}, dark to light.` : 'Open an image to take its colours.'}>
          <NumberField label="Colours" hideLabel min={LIMIT.extract[0]} max={LIMIT.extract[1]} width={80} value={v.extract} onChange={(extract) => patchView({ extract })} disabled={!d.source} />
          <Button icon="colorize" disabled={!d.source} onClick={() => void extract(doc, frame, v.extract)} tooltip={d.source ? `The ${v.extract} colours that best cover ${d.source.name}, dark to light` : 'Open an image first'}>
            Take from the image
          </Button>
        </InspectorRow>
      </div>
    </InspectorGroup>
  );
}
