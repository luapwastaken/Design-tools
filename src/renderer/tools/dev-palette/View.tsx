// DEV ONLY (plan unit D): deleted when the Design tool lands.
import { useState, useSyncExternalStore, type MouseEvent } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import type { ItemKind, Swatch, ToolId } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { Button, ControlsBoard, EmptyState, IconButton, Module, Segmented, Slider, TextInput, UndoRedo, menu, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { mapSwatch, newSwatch, type PaletteDoc } from './swatches.ts';
import s from './View.module.css';

type Doc = DocController<PaletteDoc>;
type Tab = 'swatches' | 'controls';

const TABS: { value: Tab; label: string }[] = [
  { value: 'swatches', label: 'Swatches' },
  { value: 'controls', label: 'Controls' },
];

const CHANNELS = [
  { label: 'L', name: 'lightness', max: 1, step: 0.001 },
  { label: 'C', name: 'chroma', max: 0.4, step: 0.001 },
  { label: 'H', name: 'hue', max: 360, step: 0.1 },
] as const;

const add = (doc: Doc) =>
  doc.transact('add swatch', (d) => {
    const n = d.swatches.length;
    return { ...d, swatches: [...d.swatches, newSwatch(`Swatch ${n + 1}`, [0.7, 0.12, (n * 67) % 360])] };
  });

// the tab is view state: saved with the workspace, never in history (spec §7.1)
const savedTab = (id: ToolId): Tab => ((shell.view(id) as { tab?: Tab } | undefined)?.tab === 'controls' ? 'controls' : 'swatches');

export function View({ doc }: { doc: Doc; active: boolean }) {
  const [tab, setTabState] = useState<Tab>(() => savedTab(doc.toolId));
  const setTab = (t: Tab) => {
    setTabState(t);
    shell.setView(doc.toolId, { tab: t });
  };
  const [crash, setCrash] = useState(false);
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const sendKind = useSyncExternalStore(doc.subscribe, () => shell.sendKind(doc.toolId));
  // exercises ToolHost's error module (Reload tool, Start empty, Copy details)
  if (crash) throw new Error('Crash test: the dev palette view threw on purpose.');

  return (
    <div className={s.view}>
      <Segmented<Tab> options={TABS} value={tab} onChange={setTab} fit className={s.tabs} />
      {tab === 'controls' ? (
        <div className={s.board}>
          <ControlsBoard />
        </div>
      ) : (
        <Module
          title="Palette"
          sub={`${d.swatches.length} swatches`}
          scroll
          className={s.mod}
          actions={
            <>
              <IconButton icon="bug_report" label="Crash this view (dev test)" size="sm" onClick={() => setCrash(true)} />
              <UndoRedo doc={doc} />
              <IconButton icon="add" label="Add swatch" size="sm" onClick={() => add(doc)} />
              <SendTo from={doc.toolId} kind={sendKind} />
            </>
          }
        >
          {d.swatches.length === 0 ? (
            <EmptyState
              icon="palette"
              title="No swatches"
              detail="Add one, or send a palette or an image here from the Library."
              action={{ label: 'Add swatch', icon: 'add', onClick: () => add(doc) }}
            />
          ) : (
            <div className={s.grid}>
              {d.swatches.map((w) => (
                <SwatchCard key={w.id} doc={doc} swatch={w} />
              ))}
            </div>
          )}
        </Module>
      )}
    </div>
  );
}

function SendTo({ from, kind }: { from: ToolId; kind: ItemKind | null }) {
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    if (!kind) return;
    const items: MenuItem[] = shell
      .targetsFor(kind)
      .filter((t) => t.tool.id !== from)
      .map(({ tool, use }) => ({ label: tool.label, icon: tool.icon, hint: use.label, onSelect: () => void shell.sendDoc(from, tool.id) }));
    const at = e.currentTarget.getBoundingClientRect();
    // detail 0: opened from the keyboard, so start on the first row
    menu.open(at, items.length ? items : [{ label: 'No tool takes a palette', disabled: true }], { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });
  };
  return (
    <Button size="xs" iconEnd="chevron_right" disabled={!kind} onClick={open}>
      Send to
    </Button>
  );
}

function SwatchCard({ doc, swatch }: { doc: Doc; swatch: Swatch }) {
  const edit = (label: string, fn: (w: Swatch) => Swatch) => doc.transact(label, (d) => mapSwatch(d, swatch.id, fn));
  const remove = () => doc.transact('remove swatch', (d) => ({ ...d, swatches: d.swatches.filter((w) => w.id !== swatch.id) }));
  return (
    <div className={s.card}>
      <i className={s.chip} style={{ background: cssColor(swatch.oklch) }} />
      <div className={s.head}>
        <TextInput
          value={swatch.name}
          onCommit={(name) => edit('rename swatch', (w) => ({ ...w, name }))}
          validate={(v) => (v.trim() ? null : 'A swatch needs a name.')}
          className={s.name}
        />
        <span className="val">{toHex(swatch.oklch)}</span>
        <IconButton icon="delete" label="Remove swatch" size="sm" onClick={remove} />
      </div>
      {CHANNELS.map((c, i) => (
        <Channel key={c.label} doc={doc} id={swatch.id} i={i} />
      ))}
    </div>
  );
}

function Channel({ doc, id, i }: { doc: Doc; id: string; i: number }) {
  const c = CHANNELS[i];
  const bind = useDocNumber(doc, {
    label: `change ${c.name}`,
    key: `${id}:${c.label}`,
    get: (d) => d.swatches.find((w) => w.id === id)?.oklch[i] ?? 0,
    // an edited colour is no longer the imported one, so its original values go (Swatch.source)
    set: (d, v) =>
      mapSwatch(d, id, ({ source: _, ...w }) => ({ ...w, oklch: w.oklch.map((x, j) => (j === i ? v : x)) as Swatch['oklch'] })),
  });
  return <Slider label={c.label} min={0} max={c.max} step={c.step} fieldWidth={72} {...bind} />;
}
