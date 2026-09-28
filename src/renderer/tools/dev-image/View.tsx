// DEV ONLY (plan unit D): deleted when the image tools land.
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { saveFile } from '../../lib/export.ts';
import { decodeImage } from '../../lib/load.ts';
import { shell } from '../../shell/core/index.ts';
import { Button, EmptyState, IconButton, Module, Slider, SwatchStrip, UndoRedo, menu, toast, useDocNumber, type MenuItem } from '../../ui/index.ts';
import { type ImageDoc, tool } from './index.ts';
import { fetchBlob, pixels, tint } from './pixels.ts';
import s from './View.module.css';

type Doc = DocController<ImageDoc>;

/** long edge of the on-screen copy; render() works at full resolution */
const PREVIEW = 1600;

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const strength = useDocNumber(doc, {
    label: 'change tint strength',
    key: 'strength',
    get: (d) => d.strength,
    set: (d, v) => ({ ...d, strength: v }),
  });
  const clear = () => doc.transact('clear tints', (d) => ({ ...d, tints: [] }));
  const sendKind = useSyncExternalStore(doc.subscribe, () => shell.sendKind('dev-image'));

  return (
    <div className={s.view}>
      <div className={s.board}>
        {d.source ? (
          <Preview url={d.source.url} tints={d.tints} strength={d.strength} active={active} />
        ) : (
          <EmptyState icon="add_photo_alternate" title="No image" detail="Drop or paste an image here, or send one from the Library." />
        )}
      </div>
      <Module
        title="Tint"
        sub={`${d.tints.length} colours`}
        className={s.inspector}
        actions={
          <>
            <UndoRedo doc={doc} />
            {d.tints.length > 0 && <IconButton icon="format_color_reset" label="Clear tints" size="sm" onClick={clear} />}
            <IconButton icon="download" label="Export PNG" size="sm" disabled={!d.source} onClick={() => void exportPng(d)} />
            <SendTo disabled={sendKind === null} />
          </>
        }
      >
        {d.tints.length ? (
          <SwatchStrip colors={d.tints.map(cssColor)} height={28} className={s.strip} />
        ) : (
          <p className={s.hint}>Send a palette here to tint the image.</p>
        )}
        <Slider label="Strength" min={0} max={100} unit="%" {...strength} />
      </Module>
    </div>
  );
}

/** the full-resolution render through the save dialog (spec §10.4) */
async function exportPng(d: ImageDoc): Promise<void> {
  const out = await tool.render!(d, {}).catch((e: unknown) => {
    toast.show({ kind: 'error', message: `Couldn't render the image: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  });
  if (!out) return;
  const data = await out.blob.arrayBuffer();
  const path = await saveFile({ tool: 'dev-image', suggestedName: `${out.name} · Dev image`, ext: 'png', filterName: 'PNG image', data });
  if (path) toast.show({ icon: 'download', message: `Exported ${path.split(/[\\/]/).pop()}.` });
}

/** render() → a new image in Scratch → the target's receive (spec §7.4) */
function SendTo({ disabled }: { disabled: boolean }) {
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const items: MenuItem[] = shell
      .targetsFor('image')
      .filter((t) => t.tool.id !== 'dev-image')
      .map(({ tool, use }) => ({ label: tool.label, icon: tool.icon, hint: use.label, onSelect: () => void shell.sendDoc('dev-image', tool.id) }));
    menu.open(e.currentTarget.getBoundingClientRect(), items.length ? items : [{ label: 'No tool takes an image', disabled: true }], { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });
  };
  return (
    <Button size="xs" iconEnd="chevron_right" disabled={disabled} onClick={open}>
      Send to
    </Button>
  );
}

function Preview({ url, tints, strength, active }: { url: string; tints: Oklch[]; strength: number; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<ImageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // a hidden tool frees its pixels and decodes again when shown (spec §4)
  useEffect(() => {
    if (!active) return;
    let live = true;
    setError(null);
    fetchBlob(url)
      .then((blob) => decodeImage(blob))
      .then((bmp) => (live ? setBase(pixels(bmp, PREVIEW)) : bmp.close()))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      setBase(null);
      if (canvas.current) canvas.current.width = 0;
    };
  }, [url, active]);

  useEffect(() => {
    const c = canvas.current;
    if (!base || !c) return;
    const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    tint(img.data, tints, strength);
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [base, tints, strength]);

  if (error) return <EmptyState icon="broken_image" title="This image can't be shown" detail={error} />;
  return <canvas ref={canvas} className={s.canvas} />;
}
