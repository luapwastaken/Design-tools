// The Shapes module (spec §3): up to six shapes, each with a weight (how often it appears) and its
// colour: its own, or one from the palette.
import { useMemo, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { BUILTIN_SHAPES } from '../../../shared/pattern/builtins.ts';
import { recolour, toDataUrl } from '../../../shared/svg/index.ts';
import { shell } from '../../shell/core/index.ts';
import { ColorField, ConfirmInline, IconButton, menu, Module, NumberField, Toggle, Tooltip, useDocColour, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { displayName, plural } from '../common/names.ts';
import { addBuiltin, removeSlot, replaceFromClipboard, takeFiles, type Doc } from './actions.ts';
import { LIMIT, mapSlot, MAX_SLOTS, paletteColour, type PatternDoc, type ShapeSlot } from './doc.ts';
import { armed, loading, replacing } from './view-state.ts';
import s from './Shapes.module.css';

/** the colour a recolouring shape shows in its thumbnail and field: its own, else the palette's for it */
export const colourOf = (d: PatternDoc, slot: ShapeSlot): Oklch | null =>
  slot.colour ?? (d.paletteMode === 'by-slot' ? paletteColour(d, slot.id) : d.palette[0]) ?? null;

/** Library SVGs and logos, by collection; picking one sends it here, into `replace` or as a new shape */
function libraryItems(replace: string | null): MenuItem[] {
  const groups = (shell.getState().library?.collections ?? [])
    .map((c) => ({ name: c.name || 'Library root', items: c.items.filter((i) => i.kind === 'svg' || i.kind === 'logo') }))
    .filter((g) => g.items.length);
  if (!groups.length) return [{ label: 'No SVGs or logos in the Library yet', disabled: true }];
  return groups.flatMap((g) => [
    { header: g.name },
    ...g.items.map((ref) => ({
      label: ref.name,
      hint: ref.kind === 'logo' ? 'LOGO' : 'SVG',
      onSelect: () => {
        replacing.set(replace);
        void shell.sendItem(ref, 'pattern').finally(() => replacing.set(null));
      },
    })),
  ]);
}

/** one Tab stop; the arrows move along (brief §6) */
function roam(e: KeyboardEvent<HTMLDivElement>) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  all[(all.indexOf(document.activeElement as HTMLButtonElement) + step + all.length) % all.length]?.focus();
}

const openMenu = (e: MouseEvent<HTMLButtonElement>, items: MenuItem[]) =>
  menu.open(e.currentTarget.getBoundingClientRect(), items, { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });

export function Shapes({ doc, d, counts }: { doc: Doc; d: PatternDoc; counts: Map<string, number> }) {
  const busy = loading.use() > 0;
  const armedId = armed.use();
  const file = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const pickFile = (replace: string | null) => {
    target.current = replace;
    file.current?.click();
  };
  const full = d.slots.length >= MAX_SLOTS;
  const only = d.slots.length === 1;

  return (
    <Module
      title="Shapes"
      sub={busy ? 'Reading…' : `${d.slots.length} of ${MAX_SLOTS}`}
      actions={
        <IconButton
          icon="add"
          label={full ? `A pattern holds up to ${MAX_SLOTS} shapes` : 'Add a shape from the Library or a file'}
          size="sm"
          disabled={full}
          onClick={(e) =>
            openMenu(e, [
              { label: 'From the Library', icon: 'photo_library', submenu: libraryItems(null) },
              { label: 'From a file…', icon: 'upload_file', onSelect: () => pickFile(null) },
            ])
          }
        />
      }
    >
      <div className={s.list}>
        {d.slots.map((slot) =>
          armedId === slot.id ? (
            <ConfirmInline
              key={slot.id}
              icon="delete"
              title={`Remove ${slot.name}?`}
              detail={`Its ${plural(counts.get(slot.id) ?? 0, 'item')} leave the pattern. Undo brings it back.`}
              confirmLabel="Remove"
              danger
              onConfirm={() => removeSlot(doc, slot.id)}
              onKeep={() => armed.set(null)}
            />
          ) : (
            <SlotRow key={slot.id} doc={doc} d={d} slot={slot} count={counts.get(slot.id) ?? 0} only={only} onFile={() => pickFile(slot.id)} />
          ),
        )}
      </div>
      <div className={s.builtins}>
        <span className="lbl">Built in</span>
        <div className={s.strip} role="toolbar" aria-label="Add a built-in shape" onKeyDown={roam}>
          {BUILTIN_SHAPES.map((b, n) => (
            <Tooltip key={b.id} content={full ? `${b.name}: remove a shape first` : `Add ${b.name}`}>
              <button type="button" aria-label={`Add ${b.name}`} disabled={full} tabIndex={n === 0 ? 0 : -1} className={s.builtin} onClick={() => addBuiltin(doc, b)}>
                <i style={{ '--art': `url("${toDataUrl(b.svg)}")` } as CSSProperties} />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <p className={s.hint}>Drop or paste SVG files anywhere in the tool to add them.</p>
      <input
        ref={file}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          void takeFiles(doc, files, target.current);
        }}
      />
    </Module>
  );
}

function SlotRow({ doc, d, slot, count, only, onFile }: { doc: Doc; d: PatternDoc; slot: ShapeSlot; count: number; only: boolean; onFile(): void }) {
  const { id, name } = slot;
  const weight = useDocNumber(doc, {
    label: `Change the weight of ${name}`,
    key: `${id}:weight`,
    get: (x) => x.slots.find((y) => y.id === id)?.weight ?? slot.weight,
    set: (x, w) => mapSlot(x, id, (y) => ({ ...y, weight: w })),
  });
  const shown = colourOf(d, slot);
  const colour = useDocColour(doc, {
    label: `Change the colour of ${name}`,
    key: `${id}:colour`,
    get: (x) => {
      const y = x.slots.find((z) => z.id === id) ?? slot;
      return colourOf(x, y) ?? [0, 0, 0];
    },
    set: (x, o) => mapSlot(x, id, (y) => ({ ...y, colour: o })),
  });
  const hex = shown && slot.recolour ? toHex(shown) : null;
  // a traced shape can be megabytes: only a new colour or shape redraws its thumbnail
  const thumb = useMemo(() => toDataUrl(hex ? recolour(slot.svg, hex) : slot.svg), [slot.svg, hex]);
  const off = slot.weight === 0;
  const replace: MenuItem[] = [
    { label: 'Replace with', icon: 'swap_horiz', submenu: BUILTIN_SHAPES.map((b) => ({ label: b.name, onSelect: () => addBuiltin(doc, b, id) })) },
    { label: 'Replace from the Library', icon: 'photo_library', submenu: libraryItems(id) },
    { label: 'Replace from a file…', icon: 'upload_file', onSelect: onFile },
    { label: 'Replace with copied SVG', icon: 'content_paste', onSelect: () => void replaceFromClipboard(doc, id) },
    'separator',
    { label: only ? 'Remove (a pattern keeps one shape)' : 'Remove', icon: 'delete', danger: !only, disabled: only, onSelect: () => armed.set(id) },
  ];
  const source = slot.colour ? displayName({ name: '', oklch: slot.colour }) : d.paletteMode === 'random' ? 'Random from palette' : 'From palette';

  return (
    <div className={cx(s.slot, off && s.off)}>
      <span className={s.thumb} style={d.background && !off ? { background: cssColor(d.background) } : undefined}>
        {off ? <i style={{ '--art': `url("${thumb}")` } as CSSProperties} /> : <img src={thumb} alt="" draggable={false} />}
      </span>
      <div className={s.ident}>
        <Tooltip content={name} overflowOnly>
          <span className={s.name}>{name}</span>
        </Tooltip>
        <span className="lbl">{off ? 'Left out · weight 0' : plural(count, 'item')}</span>
      </div>
      <NumberField label="Weight" size="sm" min={LIMIT.weight[0]} max={LIMIT.weight[1]} step={1} width={96} {...weight} />
      <IconButton icon="more_horiz" label={`${name}: replace or remove`} size="sm" onClick={(e) => openMenu(e, replace)} />
      <div className={s.colour}>
        <Toggle
          label="Colour from palette"
          checked={slot.recolour}
          onChange={(on) => doc.transact(on ? `Colour ${name} from the palette` : `Give ${name} its own colours`, (x) => mapSlot(x, id, (y) => ({ ...y, recolour: on })))}
          className={s.toggle}
        />
        {slot.recolour && shown && <ColorField {...colour} name={source} className={s.field} />}
        {slot.recolour && !shown && <span className={s.dim}>The palette is empty: add a colour below.</span>}
        {slot.recolour && slot.colour && (
          <IconButton icon="link" label="Follow the palette again" size="xs" onClick={() => doc.transact(`${name} follows the palette`, (x) => mapSlot(x, id, (y) => ({ ...y, colour: null })))} />
        )}
      </div>
    </div>
  );
}
