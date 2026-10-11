// Export (Design spec §4, Illustration spec §2): every format through the shared export path
// (lib/export saveFile), in a popover under the doc bar's Export button.
import { useRef, useState } from 'react';
import { writeAco, writeAse, writeCss, writeGpl, writeJson, writeKpl, writeProcreate, writeSheetSvg, writeTailwind, writeTailwind4, writeTokens, type SceneLight, type SceneNotes } from '../../../shared/palette/writers.ts';
import type { Swatch, ToolId } from '../../../shared/types.ts';
import { exporting, leaf, saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, Popover, Select, TextInput, toast, Toggle } from '../../ui/index.ts';
import { withDpi } from '../../lib/png.ts';
import { ExportButton } from './DocBar.tsx';
import { plural } from './names.ts';
import s from './ExportPalette.module.css';

export type ExportFormat = 'ase' | 'aco' | 'gpl' | 'css' | 'tailwind' | 'tailwind4' | 'tokens' | 'procreate' | 'kpl' | 'json' | 'svg' | 'png';

type Opts = { hex: boolean; scene?: SceneLight | null; notes?: SceneNotes };
type Format = {
  label: string;
  ext: string;
  /** between the name and the extension, so formats sharing an extension don't take each other's file ("brand.tailwind4.css") */
  suffix?: string;
  filter: string;
  desc: string;
  /** text a clipboard can hold: the second button copies it */
  text?: boolean;
  /** names the file gives colours: its swatches carry a role as well as a name */
  swatchNames?: boolean;
  /** the file names its swatches "Role - Colour" unless told otherwise, when the palette has roles (what Adobe's swatch panels show) */
  roleNames?: boolean;
  write(name: string, list: Swatch[], o: Opts): string | Uint8Array | Promise<Uint8Array>;
};

const FORMATS: Record<ExportFormat, Format> = {
  ase: { label: 'ASE', ext: 'ase', filter: 'Adobe swatch exchange', desc: 'Illustrator, InDesign, Photoshop and Affinity swatches, named, global and spot flags kept.', swatchNames: true, roleNames: true, write: writeAse },
  aco: { label: 'ACO', ext: 'aco', filter: 'Photoshop swatches', desc: 'Photoshop and Clip Studio Paint swatches, with names.', swatchNames: true, roleNames: true, write: (_, l) => writeAco(l) },
  gpl: { label: 'GPL', ext: 'gpl', filter: 'GIMP palette', desc: 'GIMP, Krita and Inkscape palettes.', text: true, swatchNames: true, write: writeGpl },
  css: { label: 'CSS', ext: 'css', filter: 'CSS', desc: 'Custom properties named by role, in OKLCH with a hex twin, and an --on-primary for button labels.', text: true, write: (_, l, o) => writeCss(l, o) },
  tailwind: { label: 'Tailwind 3', ext: 'js', suffix: '.tailwind.config', filter: 'Tailwind config', desc: 'A tailwind.config colours block, named by role.', text: true, write: (_, l) => writeTailwind(l) },
  tailwind4: { label: 'Tailwind 4', ext: 'css', suffix: '.tailwind4', filter: 'Tailwind theme', desc: 'An @theme block of --color variables for the stylesheet, named by role.', text: true, write: (_, l) => writeTailwind4(l) },
  tokens: { label: 'Design tokens', ext: 'json', suffix: '.tokens', filter: 'Design tokens', desc: 'A design-tokens file (W3C format) for Figma, Style Dictionary and Tokens Studio: a colour token per swatch, named by role, with the OKLCH kept alongside.', text: true, write: (_, l) => writeTokens(l) },
  procreate: { label: 'Procreate', ext: 'swatches', filter: 'Procreate swatches', desc: 'A .swatches file Procreate opens as a palette.', swatchNames: true, write: writeProcreate },
  kpl: { label: 'Krita', ext: 'kpl', filter: 'Krita palette', desc: 'Krita palettes, each ramp a group.', swatchNames: true, write: (n, l, o) => writeKpl(n, l, o.scene, o.notes) },
  json: { label: 'JSON', ext: 'json', filter: 'JSON', desc: 'Names, roles, hex and full-precision OKLCH.', text: true, write: writeJson },
  svg: { label: 'Sheet SVG', ext: 'svg', filter: 'SVG colour sheet', desc: 'A colour sheet with every swatch and its values, as vector.', text: true, write: (n, l) => writeSheetSvg(n, l) },
  png: { label: 'Sheet PNG', ext: 'png', filter: 'PNG image', desc: 'The colour sheet as a PNG at twice its size.', write: (n, l) => sheetPng(writeSheetSvg(n, l)) },
};
export const EXPORT_FORMATS = Object.keys(FORMATS) as ExportFormat[];
const OPTIONS = EXPORT_FORMATS.map((value) => ({ value, label: FORMATS[value].label }));

/** the sheet drawn through an <img> (a document of its own, spec §10.3), at 2× */
async function sheetPng(svg: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.naturalWidth * 2, img.naturalHeight * 2);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return new Uint8Array(await (await withDpi(await c.convertToBlob({ type: 'image/png' }), 144)).arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** how a swatch is named inside a file: its colour name, or its role first ("Primary - Burnt Sienna") */
type Naming = 'colour' | 'role';
const NAMING = [
  { value: 'colour', label: 'Colour name' },
  { value: 'role', label: 'Role and colour name' },
];
const withRoles = (list: Swatch[]): Swatch[] => list.map((w) => (w.role ? { ...w, name: `${w.role} - ${w.name}` } : w));

const bytesOf = (out: string | Uint8Array): string | ArrayBuffer =>
  typeof out === 'string' ? out : (out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);

export type ExportPaletteProps = {
  tool: ToolId;
  swatches: Swatch[];
  /** the swatches as the file gets them: blank names filled in (asked only when exporting) */
  named(list: Swatch[]): Swatch[];
  /** an Illustration scene's light and shadow: Krita keeps them as a group of their own */
  scene?: SceneLight | null;
  /** Krita keeps these in the palette's comment: the light's name and each ramp's material */
  notes?: SceneNotes;
  format: ExportFormat;
  onFormat(f: ExportFormat): void;
};

/** The doc bar's Export: a button, and the export settings in a popover under it. */
export function ExportPalette(p: ExportPaletteProps) {
  const [open, setOpen] = useState(false);
  // null: the file takes the palette's name, following renames; kept while the popover is closed
  const [name, setName] = useState<string | null>(null);
  // null: the format's own default (roles first in Adobe swatch files, where the palette has roles)
  const [naming, setNaming] = useState<Naming | null>(null);
  const [hex, setHex] = useState(true);
  const docName = useShell((st) => st.docNames[p.tool]);
  const button = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <ExportButton ref={button} disabled={!p.swatches.length} onClick={() => setOpen(!open)} tooltip={p.swatches.length ? 'Export the whole palette' : 'Add a colour first: an empty palette has nothing to export'} />
      {open && p.swatches.length > 0 && button.current && (
        <Popover anchor={button.current} label="Export" align="end" onClose={close} className={s.pop} focus={!docName || /^untitled/i.test(docName) ? '[data-export-name]' : undefined}>
          <ExportBody {...p} name={name} onName={setName} naming={naming} onNaming={setNaming} hex={hex} onHex={setHex} onDone={() => close(true)} />
        </Popover>
      )}
    </>
  );
}

type BodyProps = ExportPaletteProps & { name: string | null; onName(n: string | null): void; naming: Naming | null; onNaming(n: Naming): void; hex: boolean; onHex(b: boolean): void; onDone(): void };

function ExportBody({ tool, swatches, named, scene, notes, format, onFormat, name, onName, naming: chosen, onNaming, hex, onHex, onDone }: BodyProps) {
  const docName = useShell((st) => st.docNames[tool]) ?? 'Palette';
  const file = name ?? docName;
  const f = FORMATS[format];
  const naming = chosen ?? (f.roleNames && swatches.some((w) => w.role) ? 'role' : 'colour');
  const list = () => (f.swatchNames && naming === 'role' ? withRoles(named(swatches)) : named(swatches));

  // counted as running work from the first byte made (the quit check), the sheet's drawing included
  const save = () =>
    exporting(async () => {
      const out = await Promise.resolve(f.write(file, list(), { hex, scene, notes })).catch((e: unknown) => {
        toast.show({ kind: 'error', message: `Couldn't write the ${f.label} file: ${e instanceof Error ? e.message : String(e)}` });
        return null;
      });
      if (out === null) return;
      const path = await saveFile({ tool, suggestedName: file + (f.suffix ?? ''), ext: f.ext, filterName: f.filter, data: bytesOf(out) });
      if (!path) return;
      toast.show({ icon: 'download', message: `Exported ${leaf(path)}.` });
      onDone();
    });
  const copy = () =>
    navigator.clipboard.writeText(f.write(file, list(), { hex, scene, notes }) as string).then(
      () => {
        toast.show({ icon: 'content_copy', message: `Copied ${f.label} for ${plural(swatches.length, 'colour')}.` });
        onDone();
      },
      () => toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." }),
    );

  return (
    <div className={s.export}>
      <span className={s.head}>Export the whole palette</span>
      <Select label="Format" options={OPTIONS} value={format} onChange={onFormat} />
      <p className={s.desc}>{f.desc}</p>
      {f.swatchNames && <Select label="Swatch names" options={NAMING} value={naming} onChange={onNaming} />}
      {format === 'css' && <Toggle label="Hex twins" checked={hex} onChange={onHex} />}
      <TextInput mono data-export-name="" value={file} onCommit={(t) => onName(t.trim() && t.trim() !== docName ? t.trim() : null)} end={<span className={s.ext}>{f.suffix}.{f.ext}</span>} />
      <div className={s.row}>
        <Button variant="primary" size="lg" icon="download" disabled={!swatches.length} onClick={() => void save()} className={s.grow}>
          Export {f.label}
        </Button>
        {f.text && (
          <Button size="lg" icon="content_copy" disabled={!swatches.length} onClick={() => void copy()} tooltip={`Copy the ${f.label} text`}>
            Copy
          </Button>
        )}
      </div>
    </div>
  );
}
