// Export (spec §4): every format through the shared export path (lib/export saveFile).
import { useState } from 'react';
import { writeAco, writeAse, writeCss, writeGpl, writeJson, writeProcreate, writeSheetSvg, writeTailwind } from '../../../shared/palette/writers.ts';
import type { Swatch } from '../../../shared/types.ts';
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, Module, Select, TextInput, toast } from '../../ui/index.ts';
import { named, plural, type DesignDoc, type DesignView, type ExportFormat } from './doc.ts';
import { patchView } from './view-state.ts';
import s from './Export.module.css';

type Format = { label: string; ext: string; filter: string; desc: string; write(name: string, list: Swatch[]): string | Uint8Array | Promise<Uint8Array> };

const FORMATS: Record<ExportFormat, Format> = {
  ase: { label: 'ASE', ext: 'ase', filter: 'Adobe swatch exchange', desc: 'Illustrator, InDesign and After Effects swatches, named, global and spot flags kept.', write: writeAse },
  aco: { label: 'ACO', ext: 'aco', filter: 'Photoshop swatches', desc: 'Photoshop swatches, with names.', write: (_, l) => writeAco(l) },
  gpl: { label: 'GPL', ext: 'gpl', filter: 'GIMP palette', desc: 'GIMP, Krita and Inkscape palettes.', write: writeGpl },
  css: { label: 'CSS', ext: 'css', filter: 'CSS', desc: 'Custom properties named by role, in OKLCH with a hex twin.', write: (_, l) => writeCss(l) },
  tailwind: { label: 'Tailwind', ext: 'js', filter: 'Tailwind config', desc: 'A tailwind.config colours block, named by role.', write: (_, l) => writeTailwind(l) },
  procreate: { label: 'Procreate', ext: 'swatches', filter: 'Procreate swatches', desc: 'A .swatches file Procreate opens as a palette.', write: writeProcreate },
  json: { label: 'JSON', ext: 'json', filter: 'JSON', desc: 'Names, roles, hex and full-precision OKLCH.', write: writeJson },
  svg: { label: 'Sheet SVG', ext: 'svg', filter: 'SVG colour sheet', desc: 'A colour sheet with every swatch and its values, as vector.', write: (n, l) => writeSheetSvg(n, l) },
  png: { label: 'Sheet PNG', ext: 'png', filter: 'PNG image', desc: 'The colour sheet as a PNG at twice its size.', write: (n, l) => sheetPng(writeSheetSvg(n, l)) },
};
const OPTIONS = (Object.keys(FORMATS) as ExportFormat[]).map((value) => ({ value, label: FORMATS[value].label }));

/** the sheet drawn through an <img> (a document of its own, spec §10.3), at 2× */
async function sheetPng(svg: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.naturalWidth * 2, img.naturalHeight * 2);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

const bytesOf = (out: string | Uint8Array): string | ArrayBuffer =>
  typeof out === 'string' ? out : (out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);

export function Export({ d, v }: { d: DesignDoc; v: DesignView }) {
  const docName = useShell((st) => st.docNames.design) ?? 'Palette';
  // null: the file takes the palette's name, following renames
  const [name, setName] = useState<string | null>(null);
  const file = name ?? docName;
  const f = FORMATS[v.format];
  const list = () => named(d.swatches);

  const save = async () => {
    const out = await Promise.resolve(f.write(file, list())).catch((e: unknown) => {
      toast.show({ kind: 'error', message: `Couldn't write the ${f.label} file: ${e instanceof Error ? e.message : String(e)}` });
      return null;
    });
    if (out === null) return;
    const path = await saveFile({ tool: 'design', suggestedName: file, ext: f.ext, filterName: f.filter, data: bytesOf(out) });
    if (path) toast.show({ icon: 'download', message: `Exported ${path.split(/[\\/]/).pop()}.` });
  };
  const copyCss = () =>
    navigator.clipboard.writeText(writeCss(list())).then(
      () => toast.show({ icon: 'content_copy', message: `Copied CSS for ${plural(d.swatches.length, 'colour')}.` }),
      () => toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." }),
    );

  return (
    <Module title="Export" sub="Whole palette" className={s.dock}>
      <div className={s.export}>
        <Select label="Format" options={OPTIONS} value={v.format} onChange={(format) => patchView({ format })} />
        <p className={s.desc}>{f.desc}</p>
        <TextInput mono value={file} onCommit={(t) => setName(t.trim() && t.trim() !== docName ? t.trim() : null)} end={<span className={s.ext}>.{f.ext}</span>} />
        <div className={s.row}>
          <Button variant="primary" size="lg" icon="download" disabled={!d.swatches.length} onClick={() => void save()} className={s.grow}>
            Export {f.label}
          </Button>
          <Button size="lg" disabled={!d.swatches.length} onClick={() => void copyCss()}>
            Copy CSS
          </Button>
        </div>
      </div>
    </Module>
  );
}
