// Make > Pattern: seamless repeat patterns from vector shapes, as an Illustrator swatch, a vector
// artboard or a PNG. Spec: docs/superpowers/specs/2026-09-29-pattern-tool.md; plan unit V.
import type { ToolDefinition } from '../../shell/tool.ts';
import { toast } from '../../ui/index.ts';
import { fetchBlob } from '../common/take.ts';
import { leftOut, newPattern, reseed, slotFrom, takeFiles, withSlots } from './actions.ts';
import { emptyDoc, fromPayload, toPayload, withPalette, type PatternDoc } from './doc.ts';
import { StatusSlot } from './StatusSlot.tsx';
import { replacing } from './view-state.ts';
import { View } from './View.tsx';

export const tool: ToolDefinition<PatternDoc> = {
  id: 'pattern',
  label: 'Pattern',
  group: 'make',
  icon: 'pattern',
  shortcut: 3,
  docVersion: 1,
  createEmptyDoc: emptyDoc,
  // no docName: the breadcrumb shows the pattern item's name

  itemKind: 'pattern',
  toItem: toPayload,
  fromItem(item) {
    if (item.kind !== 'pattern') throw new Error(`A ${item.kind} isn't a pattern.`);
    return fromPayload(item.payload);
  },

  accepts: {
    pattern: { mode: 'open', label: 'PATTERN' },
    palette: { mode: 'apply', label: 'SHAPE COLOURS' },
    logo: { mode: 'apply', label: 'AS SHAPE' },
    svg: { mode: 'apply', label: 'AS SHAPE' },
  },
  async receive(item, _use, current) {
    // a Library pick for one slot's Replace; anything else that arrives adds a shape
    const replace = replacing.get();
    replacing.set(null);
    switch (item.kind) {
      case 'pattern':
        return tool.fromItem!(item);
      case 'palette':
        if (!current.slots.some((s) => s.recolour)) toast.show({ icon: 'info', message: 'Every shape keeps its own colours. Turn on Colour from palette on a shape to use these.' });
        return withPalette(current, item.payload.swatches);
      case 'logo':
      case 'svg': {
        const svg = item.kind === 'logo' ? (item.payload.icon ?? item.payload.wordmark) : await (await fetchBlob(item.url, item.ref.name)).text();
        if (!svg) throw new Error(`${item.ref.name} has no icon or wordmark yet.`);
        const { doc, left } = withSlots(current, [await slotFrom({ svg, name: item.ref.name })], replace);
        if (left.length) toast.show({ icon: 'info', message: leftOut(left) });
        return left.length ? current : doc;
      }
      default:
        return current;
    }
  },

  async onFiles(files, _how, doc) {
    const left = await takeFiles(doc, files);
    return left.length === files.length ? false : left.length ? left : true;
  },

  shortcuts: (doc) => [
    { keys: 'Ctrl+N', label: 'New pattern', run: () => void newPattern() },
    { keys: 'R', label: 'Reseed', run: () => reseed(doc) },
  ],
  StatusSlot,
  View,
};
