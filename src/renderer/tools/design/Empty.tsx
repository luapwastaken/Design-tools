// An empty palette: the start panel. A brand colour and Build palette make the seven roles in one step;
// the other ways in (Surprise me, image, logo, pasted codes, the Library) sit under it. It fills the
// Palette section; the picker and tabs beside it stay quiet until there is a colour.
import { useState } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { parseColours } from '../../../shared/palette/paste.ts';
import { shell } from '../../shell/core/index.ts';
import type { IconName } from '../../shell/tool.ts';
import { Button, Icon, IconButton, TextInput } from '../../ui/index.ts';
import { buildNow, eyedrop, type Doc } from './actions.ts';
import type { DesignView } from './doc.ts';
import type { OpenPop, PopKind } from './Popovers.tsx';
import { StyleFields } from './StyleFields.tsx';
import s from './Empty.module.css';

const CAN_PICK = 'EyeDropper' in globalThis;

const SOURCES: { kind: PopKind | 'library'; icon: IconName; title: string }[] = [
  { kind: 'image', icon: 'image', title: 'From image' },
  { kind: 'logo', icon: 'web_asset', title: 'From logo' },
  { kind: 'paste', icon: 'content_paste', title: 'Paste codes' },
  { kind: 'library', icon: 'folder_open', title: 'Open from Library' },
];

/** the brand colour as typed: anything the paste reader takes (hex, rgb(), hsl(), oklch(), a name); one colour only */
function readBrand(text: string): { brand: { oklch: Oklch; name: string | null } | null; problem: string | null } {
  if (!text.trim()) return { brand: null, problem: null };
  const r = parseColours(text);
  if (r.colours.length > 1) return { brand: null, problem: 'That is a list. Type one colour here, or use Paste codes.' };
  if (!r.colours.length) return { brand: null, problem: 'Type a colour: a hex, an RGB, HSL or OKLCH value, or a colour name.' };
  return { brand: { oklch: r.colours[0], name: r.names[0] }, problem: null };
}

export function Empty({ doc, v, onPop }: { doc: Doc; v: DesignView; onPop: OpenPop }) {
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const { brand, problem } = readBrand(text);
  const build = () => {
    setTried(true);
    if (brand) buildNow(doc, brand);
  };
  // a colour half typed is not an error until Build is tried
  const shown = tried ? (problem ?? (!text.trim() ? 'Type your brand colour, or press Surprise me.' : undefined)) : undefined;
  return (
    <div className={s.empty}>
      <h3 className={s.title}>Start a palette</h3>
      <p className={s.lede}>Type your brand colour and get Background, Surface, Text, Muted, Primary, Accent and Highlight, built to read.</p>
      <div className={s.build} onKeyDown={(e) => e.key === 'Enter' && (e.target as Element).tagName === 'INPUT' && build()}>
        <TextInput
          label="Brand colour"
          mono
          value={text}
          placeholder="E8643C"
          onChange={(t) => (setText(t), setTried(false))}
          onCommit={() => {}}
          end={brand ? <i className={s.chip} style={{ background: cssColor(brand.oklch) }} /> : undefined}
          error={shown}
          className={s.field}
        />
        {CAN_PICK && <IconButton icon="colorize" label="Pick from screen" shortcut="I" onClick={() => void eyedrop(doc)} />}
        <Button variant="primary" icon="star_shine" onClick={build}>
          Build palette
        </Button>
      </div>
      <div className={s.options}>
        <StyleFields doc={doc} v={v} className={s.opt} />
      </div>
      <div className={s.cards}>
        <Button icon="casino" shortcut="Space" tooltip="A palette from a random colour" onClick={() => buildNow(doc)}>
          Surprise me
        </Button>
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
