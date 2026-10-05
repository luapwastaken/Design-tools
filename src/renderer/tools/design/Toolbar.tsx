// The options bar (SPEC 3): the one home for the ways to make colours. Generate and its three
// settings, the + Add menu of sources, the eyedropper, and the view filter on the right.
import { useRef } from 'react';
import { PRESETS } from '../../../shared/palette/generate.ts';
import { Button, IconButton, InfoTip, menu, NumberField, Select } from '../../ui/index.ts';
import { OptionsBar, OptionsField } from '../common/OptionsBar.tsx';
import type { OpenPop } from './Artboard.tsx';
import { eyedrop, generateNow, regenerate, type Doc } from './actions.ts';
import type { DesignDoc, DesignView, Simulate } from './doc.ts';
import { patchView } from './view-state.ts';
import s from './Toolbar.module.css';

const CAN_PICK = 'EyeDropper' in globalThis;

const SIMULATE: { value: Simulate; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'protan', label: 'Protan' },
  { value: 'deutan', label: 'Deutan' },
  { value: 'tritan', label: 'Tritan' },
  { value: 'achromat', label: 'Achromat' },
  { value: 'greyscale', label: 'Greyscale value' },
];

export function Toolbar({ doc, d, v, onPop }: { doc: Doc; d: DesignDoc; v: DesignView; onPop: OpenPop }) {
  const add = useRef<HTMLButtonElement>(null);
  const preset = PRESETS.find((p) => p.id === v.preset);
  const open = (e: { currentTarget: HTMLButtonElement; detail: number }) => {
    const at = add.current ?? e.currentTarget;
    const pop = (kind: Parameters<OpenPop>[0]) => () => onPop(kind, at);
    menu.open(
      at.getBoundingClientRect(),
      [
        { label: 'From image…', icon: 'image', onSelect: pop('image') },
        { label: 'From logo…', icon: 'web_asset', onSelect: pop('logo') },
        { label: 'Paste codes…', icon: 'content_paste', shortcut: 'Ctrl+V', onSelect: pop('paste') },
        'separator',
        { label: 'Start from one colour…', icon: 'join', onSelect: pop('colour') },
        { label: 'Insert gradient between…', icon: 'gradient', disabled: d.swatches.length < 2, onSelect: pop('gradient') },
      ],
      { owner: at, initial: e.detail === 0 ? 0 : undefined },
    );
  };
  return (
    <div className={s.wrap}>
    <OptionsBar>
      <Button variant="primary" icon="star_shine" onClick={() => generateNow(doc)} shortcut="Space" tooltip="Generate a new palette: unlocked columns change, locked ones stay">
        Generate
        <span className={s.key}>Space</span>
      </Button>
      <OptionsField label="Style">
        <Select label="" options={PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={v.preset} onChange={(p) => regenerate(doc, { preset: p })} className={s.style} />
        {preset && <InfoTip text={preset.describe} />}
      </OptionsField>
      <OptionsField label="Colours">
        <NumberField label="Colours" hideLabel value={v.count} min={2} max={12} step={1} width={56} onChange={(count) => regenerate(doc, { count })} />
      </OptionsField>
      <OptionsField label="Seed">
        <NumberField label="Seed" hideLabel value={v.seed} min={0} max={99999} step={1} width={72} onChange={(seed) => regenerate(doc, { seed })} />
        <IconButton icon="casino" label="Reroll: a new seed" size="sm" className={s.reroll} onClick={() => regenerate(doc, { seed: 1 + Math.floor(Math.random() * 99999) })} />
      </OptionsField>
      <span className={s.rule} aria-hidden="true" />
      <Button ref={add} icon="add" iconEnd="keyboard_arrow_down" onClick={open}>
        Add
      </Button>
      {CAN_PICK && <IconButton icon="colorize" label="Pick a colour from the screen" shortcut="I" onClick={() => void eyedrop(doc)} />}
    </OptionsBar>
    </div>
  );
}

/** the view filter, in the stage's strip beside the View menu: it changes how the stage looks, never the file */
export function SimulateSelect({ v }: { v: DesignView }) {
  return (
    <OptionsField label="Simulate">
      <Select label="" options={SIMULATE} value={v.sim} onChange={(sim) => patchView({ sim })} className={s.sim} />
    </OptionsField>
  );
}

