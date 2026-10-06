// The paint toolbox: a 48px column beside the paper. Brush, Smudge and Pick are the engine's tools
// (B, S, I). Pan and Zoom are not here: the engine paints one paper at a fixed fit, with no view
// transform to pan or zoom, so those two buttons would do nothing.
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { IconButton } from '../../ui/index.ts';
import type { IconName } from '../../shell/tool.ts';
import type { PaintTool } from './paint-sources.ts';
import s from './PaintCanvas.module.css';

const TOOLS: { value: PaintTool; icon: IconName; label: string; key: string }[] = [
  { value: 'paint', icon: 'brush', label: 'Brush: paint with the loaded brush', key: 'B' },
  { value: 'smudge', icon: 'gesture', label: 'Smudge: push the paint around', key: 'S' },
  { value: 'pick', icon: 'colorize', label: 'Pick: the colour under the cursor goes to the proposals. Alt-click picks while painting.', key: 'I' },
];

export function Toolbox({ tool, onTool, colour }: { tool: PaintTool; onTool(t: PaintTool): void; colour: Oklch | null }) {
  return (
    <div className={s.toolbox} role="toolbar" aria-label="Paint tools" aria-orientation="vertical">
      {TOOLS.map((t) => (
        <IconButton key={t.value} icon={t.icon} label={t.label} shortcut={t.key} latched={tool === t.value} onClick={() => onTool(t.value)} />
      ))}
      <span className={s.grow} />
      <i className={s.current} data-colour style={colour ? { background: cssColor(colour) } : undefined} role="img" aria-label="The brush's colour" />
    </div>
  );
}
