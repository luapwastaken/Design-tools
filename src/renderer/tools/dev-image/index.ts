// DEV ONLY (plan unit D): a stub image tool so Send to between tools, "as an image" and render()
// can be exercised before the real image tools exist. The registry lists it only when not packaged;
// deleted when Dither, Halftone and Post FX land.
import type { Oklch } from '../../../shared/color/index.ts';
import type { ToolDefinition } from '../../shell/tool.ts';
import { decode, fetchBlob, pixels, tint, toPng } from './pixels.ts';
import { View } from './View.tsx';

/** the source image, copied into the workspace (spec §7.2); `hash` is the asset to keep */
export type ImageSource = { hash: string; url: string; name: string };
export type ImageDoc = { source: ImageSource | null; tints: Oklch[]; strength: number };

const ID = 'dev-image';

async function store(blob: Blob, name: string, ext: string): Promise<ImageSource> {
  const { hash, url } = await window.api.invoke('workspace.putAsset', ID, await blob.arrayBuffer(), ext);
  return { hash, url, name };
}

const extOf = (blob: Blob, fallback: string) => /^image\/(\w+)/.exec(blob.type)?.[1] ?? fallback;

export const tool: ToolDefinition<ImageDoc> = {
  id: ID,
  label: 'Dev image',
  group: 'dev',
  icon: 'image',
  shortcut: 9,
  docVersion: 1,
  createEmptyDoc: () => ({ source: null, tints: [], strength: 100 }),
  docName: (d) => d.source?.name ?? null,

  accepts: {
    image: { mode: 'open', label: 'IMAGE' },
    svg: { mode: 'open', label: 'AS IMAGE' },
    pattern: { mode: 'open', label: 'AS IMAGE' },
    logo: { mode: 'open', label: 'AS IMAGE' },
    palette: { mode: 'apply', label: 'TINT' },
  },
  async receive(item, _use, current) {
    if (item.kind === 'palette') return { ...current, tints: item.payload.swatches.map((w) => w.oklch) };
    // the shell rasterises patterns and logos; their preview SVG is only the fallback
    const blob = 'url' in item ? await fetchBlob(item.url) : new Blob([item.payload.preview.svg], { type: 'image/svg+xml' });
    return { ...current, source: await store(blob, item.ref.name, extOf(blob, item.ref.ext)) };
  },
  async render(d, { maxEdge }) {
    if (!d.source) throw new Error('There is no image to send yet.');
    const img = pixels(await decode(await fetchBlob(d.source.url)), maxEdge);
    tint(img.data, d.tints, d.strength);
    return { blob: await toPng(img), name: d.source.name, ext: 'png' };
  },

  async onFiles(files, _how, doc) {
    const file = files.find((f) => f.type.startsWith('image/'));
    if (!file) return false;
    const name = file.name.replace(/\.[^.]*$/, '') || 'Pasted image';
    const source = await store(file, name, extOf(file, 'png'));
    doc.transact(`Open ${name}`, (d) => ({ ...d, source }));
    return true;
  },

  View,
};
