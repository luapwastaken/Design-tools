import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { cssColor, type Oklch } from '../../shared/color/index.ts';
import { createDocController } from '../../shared/doc.ts';
import type { LibraryItemRef } from '../../shared/types.ts';
import { Button } from './Button.tsx';
import { ColorField } from './ColorField.tsx';
import { ConfirmInline } from './ConfirmInline.tsx';
import { cx } from './cx.ts';
import { EmptyState } from './EmptyState.tsx';
import { IconButton } from './IconButton.tsx';
import { Kbd } from './Kbd.tsx';
import { LibraryItemRow } from './LibraryItemRow.tsx';
import { MenuList } from './Menu.tsx';
import { menu, type MenuAnchor, type MenuItem, type MenuOptions } from './menu.ts';
import { Module } from './Module.tsx';
import { useDocColour } from './bind.ts';
import { NumberField } from './NumberField.tsx';
import { Picker, PickerModes, type PickerMode } from './Picker.tsx';
import { Progress } from './Progress.tsx';
import { SectionHeader } from './SectionHeader.tsx';
import { Segmented } from './Segmented.tsx';
import { Select } from './Select.tsx';
import { Slider } from './Slider.tsx';
import { SwatchStrip } from './SwatchStrip.tsx';
import { TextInput } from './TextInput.tsx';
import { toast, type ToastEntry } from './toast.ts';
import { ToastView } from './Toast.tsx';
import { Toggle } from './Toggle.tsx';
import { TipBubble, Tooltip } from './Tooltip.tsx';
import { UndoRedo } from './UndoRedo.tsx';
import s from './ControlsBoard.module.css';

// Every shared control in every state on one scrolling page, for the design critic (plan unit U).
// Static states (hover, scrubbing, an open menu) are drawn with `forceState` or in place; the
// rest is live. Sample colours are Luap's content, so they go through cssColor like real data.

const MONOLITH: [string, Oklch][] = [
  ['Ground', [0.1998, 0.0086, 264.36]],
  ['Bone', [0.9354, 0.0173, 84.59]],
  ['Iron', [0.5406, 0.0119, 261.77]],
  ['Ember', [0.6616, 0.1731, 37.3]],
  ['Moss', [0.4873, 0.0668, 155.13]],
  ['Sky', [0.7665, 0.0703, 246.81]],
];
const RUST: Oklch[] = [[0.2381, 0.0296, 40.23], [0.4539, 0.1158, 39.76], [0.6188, 0.1304, 47.01], [0.8548, 0.057, 67.81]];
const ACID: Oklch[] = [[0.173, 0, 0], [0.9396, 0.21, 121.04], [0.695, 0.2229, 355.31], [0.5311, 0.2668, 279.44], [0.9585, 0.0098, 87.47]];

const monolith = MONOLITH.map(([, c]) => cssColor(c));
// long enough to scroll in a short window
const BLENDS = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'Colour dodge', 'Colour burn', 'Hard light', 'Soft light', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Colour', 'Luminosity'];
const ROLES = ['Background', 'Text', 'Muted', 'Accent', 'Secondary', 'Highlight'];
const roleOptions = MONOLITH.map(([, c], i) => ({ value: ROLES[i], label: ROLES[i], swatch: cssColor(c) }));

const ref = (name: string, kind: LibraryItemRef['kind'], collection = 'Monolith'): LibraryItemRef => ({
  id: name,
  kind,
  name,
  collection,
  locked: false,
  path: '',
  ext: 'json',
  mtimeMs: 0,
  size: 0,
});

const SEND_TO: MenuItem[] = [
  { header: 'Send to' },
  { label: 'Illustration', icon: 'brush', hint: 'Palette' },
  { label: 'Pattern', icon: 'pattern', hint: 'Shape colours' },
  { label: 'Logo', icon: 'shapes', hint: 'Brand colours' },
  { label: 'Dither', icon: 'grain', hint: 'Palette' },
  { label: 'Halftone', icon: 'blur_on', hint: 'Inks' },
  { label: 'Post FX', icon: 'tune', hint: 'Effect colours' },
];
const ITEM_MENU: MenuItem[] = [
  { label: 'Open', icon: 'open_in_new', shortcut: 'Enter' },
  { label: 'Send to', icon: 'send', submenu: SEND_TO },
  { label: 'Rename', icon: 'edit', shortcut: 'F2' },
  { label: 'Duplicate', icon: 'content_copy', shortcut: 'Ctrl+D' },
  { label: 'Move to', icon: 'drive_file_move', submenu: [{ label: 'Monolith', disabled: true }, { label: 'Scratch' }, 'separator', { label: 'New collection', icon: 'create_new_folder' }] },
  { label: 'Reveal in Explorer', icon: 'folder_open' },
  'separator',
  { label: 'Delete', icon: 'delete', shortcut: 'Delete', danger: true },
];

const entry = (e: Partial<ToastEntry> & Pick<ToastEntry, 'message'>): ToastEntry => ({ id: '', ctrlZLive: false, leaving: false, ...e });
const noop = () => {};

const html = document.documentElement;
const onTheme = (fn: () => void) => {
  const mo = new MutationObserver(fn);
  mo.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};

function Group({ name, cap, wide, children }: { name: string; cap?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={cx(s.pg, wide && s.wide)}>
      <h2 className={cx('lbl', s.pgTitle)}>{name}</h2>
      {children}
      {cap && <p className={s.cap}>{cap}</p>}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.specimen}>
      {children}
      <span className={s.state}>{label}</span>
    </div>
  );
}

// the colour demos keep their own state, so a plane drag re-renders only them
function ColorFields() {
  const [ember, setEmber] = useState<Oklch>(MONOLITH[3][1]);
  const [sky, setSky] = useState<Oklch>(MONOLITH[5][1]);
  return (
    <>
      <ColorField value={ember} name="Ember" onChange={setEmber} />
      <ColorField value={sky} name="Sky" onChange={setSky} forceState="focus" />
      <ColorField value={MONOLITH[0][1]} name="Ground" onChange={noop} disabled />
    </>
  );
}

// bound to a small document of its own, so each drag, typed value and arrow run shows as one undo step
function PickerDemo() {
  const [doc] = useState(() => createDocController<{ ember: Oklch }>('dev-image', { ember: MONOLITH[3][1] }));
  const colour = useDocColour(doc, { label: 'change Ember', key: 'board-picker', get: (d) => d.ember, set: (d, ember) => ({ ...d, ember }) });
  const [mode, setMode] = useState<PickerMode>('oklch');
  const [lockL, setLockL] = useState(false);
  const [lockH, setLockH] = useState(false);
  return (
    <>
      <Module
        title="Picker"
        sub="Ember"
        actions={
          <>
            <UndoRedo doc={doc} />
            <PickerModes value={mode} onChange={setMode} />
          </>
        }
        className={s.pickerMod}
      >
        <Picker {...colour} mode={mode} onMode={setMode} lockL={lockL} lockH={lockH} />
      </Module>
      <div className={s.prow} style={{ gap: 18 }}>
        <Toggle label="Value lock" checked={lockL} onChange={setLockL} />
        <Toggle label="Hue lock" checked={lockH} onChange={setLockH} />
      </div>
    </>
  );
}

export function ControlsBoard() {
  const [freq, setFreq] = useState(10);
  const [gain, setGain] = useState(12);
  const [shape, setShape] = useState('Round');
  const [space, setSpace] = useState('OKLCH');
  const [role, setRole] = useState('Accent');
  const [blend, setBlend] = useState('Multiply');
  const [name, setName] = useState('Monolith core');
  const [query, setQuery] = useState('');
  const [globalSw, setGlobalSw] = useState(true);
  const [roleName, setRoleName] = useState(false);
  const [latched, setLatched] = useState(true);
  const [armed, setArmed] = useState(true);
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState('Monolith core');
  const theme = useSyncExternalStore(onTheme, () => html.dataset.theme ?? 'dark');

  const itemMenu = (at: MenuAnchor, opts: MenuOptions) => menu.open(at, ITEM_MENU, opts);

  return (
    <div className={s.board}>
      <header className={s.head}>
        <h1>Controls</h1>
        <span className="lbl">{theme} theme</span>
        <div className={s.tokens} aria-hidden="true">
          {['ground', 'module', 'well', 'raise', 'tick', 'ink-3', 'ink', 'signal', 'danger'].map((t) => (
            <div key={t}>
              <i style={{ background: `var(--${t})` }} />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </header>

      <div className={s.cols}>
        <Group name="Buttons" cap="Primary is ink on the ground, never the accent. One per module. Press moves 1px.">
          <div className={s.prow}>
            <Button variant="primary" icon="download">Export ASE</Button>
            <Button icon="add">Add swatch</Button>
            <Button variant="ghost">Cancel</Button>
          </div>
          <div className={s.prow}>
            <Button variant="danger">Delete</Button>
            <Button forceState="hover">Hover</Button>
            <Button disabled>Disabled</Button>
            <Button size="xs" iconEnd="chevron_right">Send to</Button>
          </div>
          <div className={s.prow}>
            <Button variant="primary" size="lg" icon="ios_share">Export</Button>
            <Button size="lg">Large</Button>
            <Button variant="ghost" size="xs">Ghost xs</Button>
            <Button icon="undo" tooltip="Undo: change frequency" shortcut="Ctrl+Z">Undo</Button>
          </div>
        </Group>

        <Group name="Icon buttons" cap="Tooltips carry the shortcut. Latched fills the icon.">
          <div className={s.specimens}>
            <Specimen label="Rest"><IconButton icon="colorize" label="Eyedropper" shortcut="I" /></Specimen>
            <Specimen label="Hover"><IconButton icon="colorize" label="Eyedropper" forceState="hover" /></Specimen>
            <Specimen label="Latched"><IconButton icon="colorize" label="Eyedropper" latched={latched} onClick={() => setLatched(!latched)} /></Specimen>
            <Specimen label="Off"><IconButton icon="redo" label="Redo" disabled /></Specimen>
            <Specimen label="22 px"><IconButton icon="visibility" label="Hide plate" size="sm" /></Specimen>
            <Specimen label="20 px"><IconButton icon="more_horiz" label="More" size="xs" /></Specimen>
            <Specimen label="On a swatch">
              <span className={s.onSwatch} style={{ background: monolith[3] }}>
                <IconButton icon="close" label="Remove swatch" size="xs" onContent />
              </span>
            </Specimen>
          </div>
        </Group>

        <Group name="Number field, scrub label" cap="Rest, hover, scrubbing, typing, off, out of range. Drag the label: Shift ×10, Alt ×0.1. Arrows step. Enter commits, Esc reverts.">
          <NumberField label="Frequency" value={freq} min={1} max={150} step={0.1} unit="lpi" onChange={setFreq} />
          <NumberField label="Frequency" value={14.5} min={1} max={150} step={0.1} unit="lpi" onChange={noop} forceState="hover" />
          <NumberField label="Frequency" value={14.5} min={1} max={150} step={0.1} unit="lpi" onChange={noop} forceState="scrub" />
          <NumberField label="Frequency" value={14.5} min={1} max={150} step={0.1} unit="lpi" onChange={noop} forceState="focus" />
          <NumberField label="Frequency" value={14.5} min={1} max={150} step={0.1} unit="lpi" onChange={noop} disabled />
          <NumberField label="Frequency" value={400} min={1} max={150} step={0.1} unit="lpi" onChange={noop} error="Out of range. Frequency runs 1.0 to 150.0 lpi." />
        </Group>

        <Group name="Slider and number" cap="A slider never ships alone. Ticks mark quarters and twentieths. Drag the label or the track; Esc cancels.">
          <Slider label="Frequency" value={freq} min={1} max={150} step={0.1} unit="lpi" onChange={setFreq} />
          <Slider label="Dot gain" value={gain} min={0} max={40} unit="%" onChange={setGain} />
          <Slider label="Angle" value={45} min={0} max={180} unit="°" onChange={noop} disabled />
        </Group>

        <Group name="Segmented" cap="One Tab stop; arrow keys move and choose.">
          <Segmented label="Dot shape" options={['Round', 'Ellipse', 'Line', 'Square'].map((v) => ({ value: v, label: v }))} value={shape} onChange={setShape} />
          <Segmented mono fit options={['OKLCH', 'RGB', 'CMYK'].map((v) => ({ value: v, label: v }))} value={space} onChange={setSpace} />
          <Segmented
            fit
            options={[
              { value: 'grid', label: 'Grid', icon: 'grid_view' },
              { value: 'list', label: 'List', icon: 'view_list' },
            ]}
            value="grid"
            onChange={noop}
            disabled
          />
        </Group>

        <Group name="Select">
          <Select label="Role" options={roleOptions} value={role} onChange={setRole} />
          <Select label="Blend" options={BLENDS.map((v) => ({ value: v, label: v }))} value={blend} onChange={setBlend} />
          <Select label="Role" options={roleOptions} value="Accent" onChange={noop} forceState="open" />
          <MenuList
            className={s.inlineMenu}
            items={roleOptions.map((o) => ({ label: o.label, swatch: o.swatch, checked: o.value === 'Accent' }))}
            hot={3}
          />
          <Select label="Ink" options={[{ value: 'k', label: 'Process black' }]} value="k" onChange={noop} disabled />
        </Group>

        <Group name="Text input">
          <TextInput value="" placeholder="Palette name" onCommit={noop} />
          <TextInput value={name} onCommit={setName} validate={(v) => (v.trim() ? null : 'A palette needs a name.')} forceState="focus" />
          <TextInput value="Monolith core" onCommit={noop} error="Monolith already has a palette with this name." />
          <TextInput value={query} onChange={setQuery} onCommit={setQuery} placeholder="Search 11 items" icon="search" end={<Kbd>Ctrl F</Kbd>} />
          <TextInput value="E8643C" label="Hex" mono onCommit={noop} />
        </Group>

        <Group name="Colour field" cap="Type a hex and press Enter, or click the chip for the picker. Rest, focus, off.">
          <ColorFields />
        </Group>

        <Group name="Toggle" cap="The label toggles it too.">
          <div className={s.prow} style={{ gap: 18 }}>
            <Toggle label="Global swatches" checked={globalSw} onChange={setGlobalSw} />
            <Toggle label="Role in name" checked={roleName} onChange={setRoleName} />
          </div>
          <div className={s.prow} style={{ gap: 18 }}>
            <Toggle label="Locked on" checked disabled onChange={noop} />
            <Toggle label="Locked off" checked={false} disabled onChange={noop} />
          </div>
        </Group>

        <Group name="Modules and section headers" cap="Module, module with a setting, collections.">
          <Module title="Inks" sub="4 plates" actions={<IconButton icon="add" label="Add ink" size="sm" />} className={s.demoMod}>
            <span className={s.muted}>Body scrolls; the header stays.</span>
          </Module>
          <Module
            title="Colour vision"
            flush
            actions={<NumberField label="Flag <" value={8} min={0} max={100} step={0.1} unit="ΔE" size="sm" width={98} onChange={noop} />}
            className={s.demoMod}
          />
          <Module title="Export" readout="2048 × 2048" footer={<span>Last export 14:32 to Desktop</span>} className={s.demoMod}>
            <span className={s.muted}>A module with a readout and a footer.</span>
          </Module>
          <div>
            <SectionHeader title="Monolith" readout={4} expanded={open} onToggle={() => setOpen(!open)} actions={<IconButton icon="lock_open" label="Lock collection" size="xs" />} />
            <SectionHeader title="Scratch" sub="never locked" readout={3} expanded={false} onToggle={noop} />
          </div>
        </Group>

        <Group name="Armed confirm" cap="Says what happens and what is kept, from facts the app knows. Focus lands on Keep; Esc keeps.">
          {armed ? (
            <ConfirmInline
              icon="delete"
              title="Delete palette “Rust test”?"
              detail="4 swatches. Goes to the Recycle Bin when this closes. Open in Illustration; it stays open there, detached."
              confirmLabel="Delete"
              danger
              onConfirm={() => {
                setArmed(false);
                toast.show({ icon: 'delete', message: <>Deleted <b>Rust test</b></>, undo: () => setArmed(true) });
              }}
              onKeep={() => setArmed(false)}
            />
          ) : (
            <Button variant="danger" icon="delete" onClick={() => setArmed(true)}>Arm delete</Button>
          )}
        </Group>

        <Group name="Toasts" cap="Undo toasts stay 8s, paused on hover. Ctrl Z shows only while Ctrl+Z will do it. Errors stay until dismissed.">
          <ToastView entry={entry({ icon: 'delete', message: <>Deleted <b>Rust test</b></>, undo: noop })} ctrlZ />
          <ToastView entry={entry({ icon: 'drive_file_move', message: <>Moved <b>Tile 07</b> to Scratch</>, undo: noop })} />
          <ToastView entry={entry({ kind: 'error', message: "Couldn't write Monolith core. The disk is full." })} />
          <div className={s.prow}>
            <Button size="xs" onClick={() => toast.show({ icon: 'delete', message: <>Deleted <b>Tile 07</b></>, undo: noop })}>Undo toast</Button>
            <Button size="xs" onClick={() => toast.show({ icon: 'send', message: <>Opened <b>Monolith core</b> in Halftone</> })}>Info</Button>
            <Button size="xs" onClick={() => toast.show({ kind: 'error', message: "Couldn't read Etch scan 04.tif." })}>Error</Button>
            <Button size="xs" variant="ghost" onClick={() => toast.noteCommit()}>Tool commit</Button>
          </div>
        </Group>

        <Group name="Tooltip" cap="After 500ms of hover, at once if another closed within 300ms. Flips before the caption buttons.">
          <div className={s.prow} style={{ gap: 10 }}>
            <IconButton icon="colorize" label="Eyedropper" forceState="hover" />
            <TipBubble content="Eyedropper" shortcut="I" />
          </div>
          <div className={s.prow}>
            <TipBubble content="Undo: change frequency" shortcut="Ctrl+Z" />
          </div>
        </Group>

        <Group name="Progress" cap="Counts, not prose. The spinner turns only while work runs.">
          <Progress label="Rendering halftone" value={0.62} detail="6,655 of 10,735 dots" onCancel={noop} />
          <Progress label="Reading Etch scan 04.tif" value={null} />
        </Group>

        <Group name="Empty state">
          <EmptyState icon="add_photo_alternate" title="No images in Scratch yet" detail="Drop a PNG, JPG or SVG here, or paste with Ctrl+V." action={{ label: 'Choose file', icon: 'folder_open', onClick: noop }} />
        </Group>

        <Group name="Keys and swatches">
          <div className={s.prow}>
            <Kbd>Ctrl Z</Kbd>
            <Kbd>Ctrl Shift Z</Kbd>
            <Kbd>F2</Kbd>
            <Kbd>Del</Kbd>
            <Kbd>Esc</Kbd>
          </div>
          <SwatchStrip colors={monolith} height={26} />
          <SwatchStrip colors={ACID.map(cssColor)} height={14} />
        </Group>
      </div>

      <div className={s.wideRow}>
        <Group name="Context menu, Send to" cap="Right-click the row for the live menu. The current row is popover-hot, never raise." wide>
          <div className={s.menuStage}>
            <div className={s.menuRow}>
              <LibraryItemRow item={ref('Monolith core', 'palette')} meta="6" thumb={<SwatchStrip colors={monolith} />} selected onOpen={noop} onMenu={itemMenu} />
            </div>
            <MenuList className={s.menuRoot} items={ITEM_MENU} hot={1} />
            <MenuList className={s.menuSub} items={SEND_TO} hot={5} />
          </div>
        </Group>

        <Group name="Picker" cap="Drag the plane or a track: each drag is one step, Esc cancels. Arrows on the plane nudge L and C, Shift ×10. Solid edge sRGB, dashed P3; past sRGB is dimmed." wide>
          <PickerDemo />
        </Group>

        <Group name="Library item" cap="Selected and open, hover with the active tool's use, long names end in an ellipsis (hover shows the full name).">
          <div className={s.list} role="listbox" aria-label="Library">
            {[
              { name: 'Monolith core', meta: '6', colors: monolith, openIn: 'Design' },
              { name: 'Rust test', meta: '4', colors: RUST.map(cssColor), accepted: 'Inks', force: true },
              { name: 'Polychef post 14, acid spring with film grain, final v3', meta: '5', colors: ACID.map(cssColor) },
              { name: 'Monolith packaging', meta: '9', colors: [...monolith].reverse(), anchor: true },
            ].map((r) => (
              <LibraryItemRow
                key={r.name}
                item={ref(r.name, 'palette')}
                meta={r.meta}
                thumb={<SwatchStrip colors={r.colors} />}
                selected={sel === r.name || r.anchor}
                anchor={r.anchor}
                accepted={r.accepted}
                openIn={r.openIn}
                forceState={r.force ? 'hover' : undefined}
                onSelect={() => setSel(r.name)}
                onOpen={noop}
                onMenu={itemMenu}
                dragData={r.name}
                actions={<Button size="xs" iconEnd="chevron_right" variant={sel === r.name ? 'secondary' : 'ghost'} tabIndex={-1}>Send to</Button>}
              />
            ))}
          </div>
          <Tooltip content="Only one tooltip shows at a time.">
            <span className={s.muted}>Hover me for a live tooltip.</span>
          </Tooltip>
        </Group>
      </div>
    </div>
  );
}
