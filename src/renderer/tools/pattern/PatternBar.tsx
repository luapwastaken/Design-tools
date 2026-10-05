// The pattern's chrome above the canvas: the doc bar (name and place, New, undo, Send to, Export, which
// opens a menu of the formats) and the options bar (the arrangement as pictograms, Surprise me).
import { useRef } from 'react';
import { Button, IconButton, menu, Segmented } from '../../ui/index.ts';
import { DocBar, ExportButton } from '../common/DocBar.tsx';
import { OptionsBar, OptionsField } from '../common/OptionsBar.tsx';
import { plural } from '../common/names.ts';
import { newPattern, surprise, type Doc } from './actions.ts';
import type { PatternDoc } from './doc.ts';
import type { PatternExport } from './Export.tsx';
import { ARRANGEMENTS } from './Layout.tsx';

export function PatternBar({ doc, d, out }: { doc: Doc; d: PatternDoc; out: PatternExport }) {
  const button = useRef<HTMLButtonElement>(null);
  const busy = out.ex.busy !== null;
  const openExport = () => {
    const at = button.current;
    if (!at) return;
    menu.open(
      at.getBoundingClientRect(),
      [
        { label: 'Illustrator swatch (SVG)', icon: 'download', onSelect: () => void out.swatch() },
        { label: 'Artboard (SVG)', icon: 'download', disabled: !!out.boardProblem, hint: out.boardProblem ? 'Too many shapes' : undefined, onSelect: () => void out.artboard() },
        { label: 'PNG', icon: 'download', disabled: !!out.pngProblem, hint: out.pngProblem ? 'Too big' : undefined, onSelect: () => void out.png() },
        'separator',
        { label: 'Copy the swatch SVG', icon: 'content_copy', onSelect: () => void out.copySwatch() },
        { label: 'Copy the artboard SVG', icon: 'content_copy', disabled: !!out.boardProblem, onSelect: () => void out.copyArtboard() },
      ],
      { owner: at },
    );
  };
  return (
    <>
      <DocBar
        tool="pattern"
        doc={doc}
        meta={plural(d.slots.length, 'shape')}
        actions={<IconButton icon="note_add" label="New pattern" shortcut="Ctrl+N" size="sm" onClick={() => void newPattern()} />}
        send={{ noun: 'pattern', empty: 'Change something first: a pattern goes into the Library with its first edit' }}
        exportButton={<ExportButton ref={button} disabled={busy} tooltip={busy ? 'An export is running' : 'Export the swatch, the artboard or a PNG (their sizes are in the Export group)'} onClick={openExport} />}
      />
      <OptionsBar>
        <OptionsField label="Arrangement">
          <Segmented
            fit
            options={ARRANGEMENTS.map((a) => ({ value: a.value, label: a.label, icon: a.icon, tip: a.tip }))}
            value={d.arrangement}
            onChange={(arrangement) => doc.transact(`Arrange as ${ARRANGEMENTS.find((x) => x.value === arrangement)!.label.toLowerCase()}`, (x) => ({ ...x, arrangement }))}
          />
        </OptionsField>
        <span style={{ flex: 1 }} />
        <Button icon="wand_stars" onClick={() => surprise(doc)} tooltip="Surprise me: a new arrangement, spacing, size and turns. The shapes and colours stay.">
          Surprise me
        </Button>
      </OptionsBar>
    </>
  );
}
