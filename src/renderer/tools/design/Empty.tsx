// An empty palette (SPEC 3): one sentence, the one primary action, then the other ways in. It fills
// the Palette section; the picker and tabs beside it stay quiet until there is a colour.
import { PRESETS } from '../../../shared/palette/generate.ts';
import { shell } from '../../shell/core/index.ts';
import type { IconName } from '../../shell/tool.ts';
import { Button, Icon } from '../../ui/index.ts';
import { generateNow, type Doc } from './actions.ts';
import type { DesignView } from './doc.ts';
import type { OpenPop, PopKind } from './Popovers.tsx';
import s from './Empty.module.css';

const SOURCES: { kind: PopKind | 'library'; icon: IconName; title: string }[] = [
  { kind: 'image', icon: 'image', title: 'From image' },
  { kind: 'logo', icon: 'web_asset', title: 'From logo' },
  { kind: 'paste', icon: 'content_paste', title: 'Paste codes' },
  { kind: 'colour', icon: 'join', title: 'Harmony from a colour' },
  { kind: 'library', icon: 'folder_open', title: 'Open from Library' },
];

export function Empty({ doc, v, onPop }: { doc: Doc; v: DesignView; onPop: OpenPop }) {
  const style = PRESETS.find((p) => p.id === v.preset)?.label ?? 'Palette';
  return (
    <div className={s.empty}>
      <h3 className={s.title}>Start a palette</h3>
      <p className={s.lede}>Generate one, or bring colours in. Nothing is final: every colour stays editable.</p>
      <div className={s.go}>
        <Button variant="primary" size="lg" icon="star_shine" onClick={() => generateNow(doc)} shortcut="Space" tooltip="Generate a palette">
          Generate a palette
        </Button>
        <span className={s.dim}>
          {style} · {v.count} colours · seed {v.seed}. Change them from the caret beside Generate.
        </span>
      </div>
      <div className={s.cards}>
        {SOURCES.map((c) => (
          <Button key={c.kind} icon={c.icon} onClick={(e) => (c.kind === 'library' ? shell.toggleLibrary(true) : onPop(c.kind, e.currentTarget))}>
            {c.title}
          </Button>
        ))}
      </div>
      <p className={s.drop}>
        <Icon name="image" size={14} />
        Drop an image, SVG or palette file anywhere on the canvas, or press Ctrl+V to paste colour codes.
      </p>
    </div>
  );
}
