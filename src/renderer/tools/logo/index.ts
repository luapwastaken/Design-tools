// Make > Logo: lockups from an icon and a wordmark, each with its own proportions, as editable
// vectors and PNGs. Spec: docs/superpowers/specs/2026-09-29-logo-tool.md; plan unit V.
import type { ToolDefinition, Use } from '../../shell/tool.ts';
import { shell } from '../../shell/core/index.ts';
import { fetchBlob } from '../common/take.ts';
import { arrowsFree } from '../common/keyGates.ts';
import { copySvg, imagePart, newLogo, nextRole, step, stepVersion, svgPart, takeFiles, takePalette } from './actions.ts';
import { emptyDoc, fromPayload, isEmpty, toPayload, withPart, type LogoDoc } from './doc.ts';
import { logoShortcuts } from './keys.ts';
import { getView, patchView } from './view-state.ts';
import { View } from './View.tsx';

/** the part the next SVG or image fills, as Send to and the Library name it */
const asPart = (png: boolean): Use => {
  const role = nextRole(shell.doc('logo').get() as LogoDoc | null);
  return { mode: 'apply', label: `${role.toUpperCase()}${png ? ' (PNG)' : ''}` };
};

export const tool: ToolDefinition<LogoDoc> = {
  id: 'logo',
  label: 'Logo',
  group: 'make',
  icon: 'branding_watermark',
  shortcut: 4,
  needsAlpha: true,
  docVersion: 1,
  createEmptyDoc: emptyDoc,
  isEmpty,
  // no docName: the breadcrumb shows the logo item's name

  itemKind: 'logo',
  toItem: toPayload,
  fromItem(item) {
    if (item.kind !== 'logo') throw new Error(`A ${item.kind} isn't a logo.`);
    return fromPayload(item.payload);
  },

  // getters: an SVG or image goes into the first empty part (icon first), so its label follows the document
  accepts: {
    logo: { mode: 'open', label: 'LOGO' },
    get svg() {
      return asPart(false);
    },
    get image() {
      return asPart(true);
    },
    palette: { mode: 'apply', label: 'COLOURS' },
  },
  async receive(item, _use, current) {
    const role = nextRole(current);
    switch (item.kind) {
      case 'logo':
        return tool.fromItem!(item);
      case 'palette':
        return takePalette(current, item.ref.name, item.payload.swatches);
      case 'svg': {
        const text = await (await fetchBlob(item.url, item.ref.name)).text();
        return withPart(current, role, await svgPart(text, item.ref.name, role));
      }
      case 'image':
        return withPart(current, role, await imagePart(await fetchBlob(item.url, item.ref.name), item.ref.name, role));
      default:
        return current;
    }
  },

  async onFiles(files, _how, doc) {
    const left = await takeFiles(doc, files);
    return left.length === files.length ? false : left.length ? left : true;
  },

  shortcuts: (doc) => logoShortcuts(doc, { newLogo: () => void newLogo(), step, stepVersion, copySvg: (d) => void copySvg(d), view: getView, patch: patchView, arrowsFree: () => arrowsFree('logo', '[data-logo-stage]') }),
  View,
};
