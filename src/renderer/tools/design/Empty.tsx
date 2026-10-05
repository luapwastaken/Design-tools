// An empty palette (SPEC 3, mockup-empty.png): one sentence, the one primary action, then the other
// ways in. This replaces the three "empty" messages the old screen had.
import { PRESETS } from '../../../shared/palette/generate.ts';
import { shell } from '../../shell/core/index.ts';
import type { IconName } from '../../shell/tool.ts';
import { Button, Icon } from '../../ui/index.ts';
import type { OpenPop, PopKind } from './Artboard.tsx';
import { generateNow, type Doc } from './actions.ts';
import type { DesignView } from './doc.ts';
import s from './Empty.module.css';

const SOURCES: { kind: PopKind | 'library'; icon: IconName; title: string; sub: string }[] = [
  { kind: 'image', icon: 'image', title: 'From image', sub: 'Pull colours from a photo. Drop or paste one.' },
  { kind: 'logo', icon: 'web_asset', title: 'From logo', sub: 'Take a logo’s fill and stroke colours.' },
  { kind: 'paste', icon: 'content_paste', title: 'Paste codes', sub: 'Hex, RGB, HSL or OKLCH, one per line.' },
  { kind: 'colour', icon: 'colorize', title: 'Start from one colour', sub: 'Type a hex, then pick a harmony.' },
  { kind: 'library', icon: 'folder_open', title: 'Open from Library', sub: '.ase, .aco and .gpl palettes.' },
];

export function Empty({ doc, v, onPop }: { doc: Doc; v: DesignView; onPop: OpenPop }) {
  const style = PRESETS.find((p) => p.id === v.preset)?.label ?? 'Palette';
  return (
    <div className={s.empty}>
      <h2 className={s.title}>Start a palette</h2>
      <p className={s.lede}>Generate one, or bring colours in. Nothing is final: every colour stays editable.</p>
      <div className={s.go}>
        <Button variant="primary" size="lg" icon="star_shine" onClick={() => generateNow(doc)} shortcut="Space" tooltip="Generate a palette">
          Generate a palette
          <span className={s.key}>Space</span>
        </Button>
        <span className={s.dim}>
          {style} · {v.count} colours · seed {v.seed}. Change them in the bar above.
        </span>
      </div>
      <div className={s.cards}>
        {SOURCES.map((c) => (
          <button key={c.kind} type="button" className={s.card} onClick={(e) => (c.kind === 'library' ? shell.toggleLibrary(true) : onPop(c.kind, e.currentTarget))}>
            <span className={s.ico}>
              <Icon name={c.icon} size={18} />
            </span>
            <b>{c.title}</b>
            <span className={s.sub}>{c.sub}</span>
          </button>
        ))}
      </div>
      <div className={s.drop}>
        <Icon name="image" size={16} />
        <span>Drop an image, SVG or palette file anywhere on the canvas.</span>
        <span className={s.keys}>
          <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes colour codes
        </span>
      </div>
    </div>
  );
}
