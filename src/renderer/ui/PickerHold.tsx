import { useRef } from 'react';
import { cssColor, type Oklch } from '../../shared/color/index.ts';
import { valueOf } from '../../shared/color/value.ts';
import { Button } from './Button.tsx';
import { menu } from './menu.ts';
import { NumberField } from './NumberField.tsx';
import type { Gesture } from './Picker.tsx';
import type { usePickerColour } from './pickerModels.ts';
import { toggleHueLock, toggleValueLock, useHueLock, useValueLock } from './PickerStyles.tsx';
import { roundTo } from './scrub.ts';
import { Toggle } from './Toggle.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './Picker.module.css';

/** why a held channel's track doesn't drag (its tooltip) */
export const VALUE_HELD = 'Value is held: type it in the Value field, or turn off Hold value';
export const HUE_HELD = 'Hue is held: turn off Hold hue to move it';

const HOLD_VALUE = "Keeps this colour's value (its grey, Rec. 709) while hue and chroma move. Applies to every picker.";
const HOLD_HUE = 'Keeps the hue while you drag.';

/** a palette colour the Match menu offers */
export type Match = { name: string; oklch: Oklch };

/**
 * The hold row, in every picker body: Hold value (V), the colour's Value (typable always: with the
 * hold on it is the value held), Hold hue, and in the palette tools Match, which sets the value to
 * another palette colour's. The holds are app-wide settings, so every picker follows them.
 */
export function PickerHold({ value, colour, match, ...g }: { value: Oklch; colour: ReturnType<typeof usePickerColour>; match?: Match[] } & Gesture) {
  const valueHeld = useValueLock();
  const hueHeld = useHueLock();
  const pick = useRef<HTMLButtonElement>(null);
  const grey = valueOf(value);
  const setValue = (t: number) => {
    g.onBegin?.();
    colour.setValue(t);
    g.onCommit?.();
  };
  const openMatch = () => {
    const el = pick.current!;
    menu.open(
      el.getBoundingClientRect(),
      [
        { header: 'Match the value of' },
        ...match!.map((m) => ({ label: m.name, swatch: cssColor(m.oklch), hint: (valueOf(m.oklch) * 100).toFixed(1), onSelect: () => setValue(valueOf(m.oklch)) })),
      ],
      { owner: el, width: 260 },
    );
  };
  return (
    <div className={s.hold} role="group" aria-label="Hold">
      <Tooltip content={HOLD_VALUE} shortcut="V">
        <span>
          <Toggle checked={valueHeld} onChange={toggleValueLock} label="Hold value" />
        </span>
      </Tooltip>
      <Tooltip content="Rec. 709 luma: the grey a greyscale view shows. L and C change while this is held.">
        <span className={s.holdValue}>
          <NumberField
            label="Value"
            value={roundTo(grey * 100, 1)}
            min={0}
            max={100}
            step={0.5}
            precision={1}
            {...g}
            onChange={(x) => colour.setValue(x / 100)}
          />
        </span>
      </Tooltip>
      <Tooltip content={HOLD_HUE}>
        <span>
          <Toggle checked={hueHeld} onChange={toggleHueLock} label="Hold hue" />
        </span>
      </Tooltip>
      {match && match.length > 0 && (
        <Button ref={pick} size="xs" iconEnd="keyboard_arrow_down" tooltip="Set this colour's value to another palette colour's" onClick={openMatch}>
          Match
        </Button>
      )}
      {valueHeld && colour.target === null && <span className={s.holdNote}>Nothing to hold at black or white</span>}
    </div>
  );
}
