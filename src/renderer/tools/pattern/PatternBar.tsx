// The pattern's chrome above the canvas: the doc bar (name and place, New, undo, Send to, Export, which
// opens a menu of the formats) and the options bar (the arrangement as pictograms, Surprise me and its Keep / Discard).
import { useState } from 'react';
import { Button, Icon, IconButton, Segmented, type MenuItem } from '../../ui/index.ts';
import { DocBar, ExportMenu } from '../common/DocBar.tsx';
import { OptionsBar, OptionsField } from '../common/OptionsBar.tsx';
import { plural } from '../common/names.ts';
import { newPattern, surprise, type Doc } from './actions.ts';
import type { PatternDoc } from './doc.ts';
import type { PatternExport } from './Export.tsx';
import { ARRANGEMENTS } from './Layout.tsx';
import s from './PatternBar.module.css';

export function PatternBar({ doc, d, out }: { doc: Doc; d: PatternDoc; out: PatternExport }) {
  // Surprise me is a proposal until it is kept: it stands while the document is exactly what it made, so any edit keeps it
  const [made, setMade] = useState<PatternDoc | null>(null);
  const proposing = made !== null && d === made;
  const busy = out.ex.busy !== null;
  const items = (): MenuItem[] => [
    { label: 'Illustrator swatch (SVG)', icon: 'download', onSelect: () => void out.swatch() },
    { label: 'Artboard (SVG)', icon: 'download', disabled: !!out.boardProblem, hint: out.boardProblem ? 'Too many shapes' : undefined, onSelect: () => void out.artboard() },
    { label: 'PNG', icon: 'download', disabled: !!out.pngProblem, hint: out.pngProblem ? 'Too big' : undefined, onSelect: () => void out.png() },
    'separator',
    { label: 'Copy the swatch SVG', icon: 'content_copy', onSelect: () => void out.copySwatch() },
    { label: 'Copy the artboard SVG', icon: 'content_copy', disabled: !!out.boardProblem, onSelect: () => void out.copyArtboard() },
  ];
  return (
    <>
      <DocBar
        tool="pattern"
        doc={doc}
        meta={plural(d.slots.length, 'shape')}
        actions={<IconButton icon="note_add" label="New pattern" shortcut="Ctrl+N" size="sm" onClick={() => void newPattern()} />}
        send={{ noun: 'pattern', empty: 'Change something first: a pattern goes into the Library with its first edit' }}
        exportButton={<ExportMenu items={items} disabled={busy} tooltip={busy ? 'An export is running' : 'Export the swatch, the artboard or a PNG (their sizes are in the Export group)'} />}
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
        {proposing && (
          <span className={s.proposal} data-proposal>
            <span className={s.mark}>
              <Icon name="wand_stars" size={14} />
              Proposal
            </span>
            <Button size="xs" onClick={() => setMade(null)} tooltip="Keep this layout">
              Keep
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                doc.undo();
                setMade(null);
              }}
              tooltip="Go back to the layout before"
            >
              Discard
            </Button>
          </span>
        )}
        <Button
          icon="wand_stars"
          onClick={() => {
            surprise(doc);
            setMade(doc.get());
          }}
          tooltip="Surprise me: a new arrangement, spacing, size and turns. The shapes and colours stay."
        >
          Surprise me
        </Button>
      </OptionsBar>
    </>
  );
}
