// Export (spec §3): the lockup being edited as an editable SVG or a PNG at a set height, every lockup ×
// version into one folder, the favicon bundle and the brand sheet. All through the shared export
// path (lib/export saveFile, saveToFolder); every failure is a toast.
import { useState, type ReactNode } from 'react';
import { layoutLockup } from '../../../shared/logo/layout.ts';
import { lockupSvg } from '../../../shared/logo/svg.ts';
import { saveFile, saveToFolder } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, Module, NumberField, toast, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { fix, KIND_LABEL, LIMIT, shownLockups, shownVersions, VERSION_LABEL, type Lockup, type LogoDoc } from './doc.ts';
import { buffer, everyFile, faviconBundle, fileName, lockupPng, sheetPng, sheetSvg, type OutFile } from './files.ts';
import { pngSize } from './geometry.ts';
import { tooBig } from './raster.ts';
import { patchView, type LogoView } from './view-state.ts';
import s from './Export.module.css';

function Row({ name, desc, children, action }: { name: string; desc: ReactNode; children?: ReactNode; action: ReactNode }) {
  return (
    <div className={s.item}>
      <div className={s.text}>
        <b className={s.name}>{name}</b>
        <p className={s.desc}>{desc}</p>
      </div>
      {action}
      {children && <div className={s.more}>{children}</div>}
    </div>
  );
}

export function ExportModule({ doc, d, v, lockup }: { doc: Doc; d: LogoDoc; v: LogoView; lockup: Lockup | null }) {
  const name = useShell((st) => st.docNames.logo) ?? 'Logo';
  const [busy, setBusy] = useState<string | null>(null);
  const height = useDocNumber(doc, { label: 'Change the PNG height', key: 'pngHeight', get: (x) => x.pngHeight, set: (x, h) => fix({ ...x, pngHeight: h }) });
  const lockups = shownLockups(d);
  const versions = shownVersions(d);

  const run = async (what: string, make: () => Promise<string | null>) => {
    setBusy(what);
    try {
      const done = await make();
      if (done) toast.show({ icon: 'download', message: done });
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't make the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };
  const one = (what: string, ext: string, filterName: string, suggestedName: string, data: () => Promise<ArrayBuffer | string>) =>
    run(what, async () => {
      const path = await saveFile({ tool: 'logo', suggestedName, ext, filterName, data: await data() });
      return path && `Exported ${path.split(/[\\/]/).pop()}.`;
    });
  const many = (what: string, files: () => Promise<OutFile[]>) =>
    run(what, async () => {
      const list = await files();
      const r = await saveToFolder({ tool: 'logo', files: list });
      return r && `Exported ${plural(r.written.length, 'file')} into ${r.folder.split(/[\\/]/).pop()}.`;
    });

  const sized = lockup && pngSize(d, layoutLockup(d, lockup), v.version);
  const pngProblem = sized && tooBig(sized.w, sized.h);
  // Export all makes every PNG: the widest one on decides
  const allProblem = lockups.flatMap((l) => versions.map((x) => pngSize(d, layoutLockup(d, l), x))).map((p) => tooBig(p.w, p.h)).find(Boolean) ?? null;
  const noIcon = !d.icon ? 'The favicon is made from the icon. Add an icon first.' : null;
  const off = busy !== null;

  return (
    <Module title="Export" sub={lockup ? `${KIND_LABEL[lockup.kind]} · ${VERSION_LABEL[v.version]}` : undefined}>
      <div className={s.list}>
        {lockup && (
          <>
            <Row
              name="SVG"
              desc="The lockup in its version as real paths with their own fills, each part one group: editable in Illustrator."
              action={
                <Button variant="primary" icon="download" disabled={off} onClick={() => void one('SVG', 'svg', 'SVG', fileName(name, lockup, v.version), async () => lockupSvg(d, lockup, v.version, { padding: d.exportPadding }))}>
                  {busy === 'SVG' ? 'Exporting…' : 'Export'}
                </Button>
              }
            />
            <Row
              name="PNG"
              desc={v.version === 'knockout' ? 'The same at a set height on its colour field, the DPI written in.' : 'The same at a set height, transparent round the logo, the DPI written in.'}
              action={
                <Button icon="download" disabled={off || !!pngProblem} tooltip={pngProblem ?? undefined} onClick={() => void one('PNG', 'png', 'PNG image', fileName(name, lockup, v.version), async () => buffer(await lockupPng(d, lockup, v.version, v.dpi)))}>
                  {busy === 'PNG' ? 'Exporting…' : 'Export'}
                </Button>
              }
            >
              <div className={s.pair}>
                <NumberField label="Height" min={LIMIT.pngHeight[0]} max={LIMIT.pngHeight[1]} unit="px" {...height} />
                <NumberField label="DPI" min={LIMIT.dpi[0]} max={LIMIT.dpi[1]} value={v.dpi} onChange={(dpi) => patchView({ dpi })} />
              </div>
              {sized && (
                <span className={cx('lbl', pngProblem && s.danger)}>
                  {sized.w} × {sized.h} px{pngProblem ? ' · too big' : ''}
                </span>
              )}
            </Row>
          </>
        )}

        <Row
          name="Export all"
          desc="Every lockup that’s on in every version that’s on, as SVG and PNG, into one folder."
          action={
            <Button
              icon="folder_open"
              disabled={off || !lockups.length || !versions.length || !!allProblem}
              tooltip={allProblem ?? undefined}
              onClick={() => void many('files', () => everyFile(d, name, v.dpi))}
            >
              {busy === 'files' ? 'Exporting…' : 'Export all…'}
            </Button>
          }
        >
          <span className="lbl">
            {plural(lockups.length, 'lockup')} × {plural(versions.length, 'version')} · {lockups.length * versions.length * 2} files
          </span>
        </Row>

        <Row
          name="Favicon bundle"
          desc={`From the icon in ${VERSION_LABEL[v.version].toLowerCase()}: favicon.ico, PNGs from 16 to 512 px, an Apple touch icon, icon.svg and a web manifest, into one folder.`}
          action={
            <Button
              icon="folder_open"
              disabled={off || !!noIcon}
              tooltip={noIcon ?? undefined}
              onClick={() => void many('favicon bundle', () => faviconBundle(d, v.version, name))}
            >
              {busy === 'favicon bundle' ? 'Exporting…' : 'Export…'}
            </Button>
          }
        />

        <Row
          name="Brand sheet"
          desc="One page with every lockup and version, the clearspace, the small sizes and the colours, to drop into a guidelines document."
          action={
            <div className={s.buttons}>
              <Button icon="download" disabled={off || !lockups.length} onClick={() => void one('brand sheet', 'svg', 'SVG', `${name} brand sheet`, () => sheetSvg(d, name))}>
                {busy === 'brand sheet' ? 'Exporting…' : 'SVG'}
              </Button>
              <Button
                icon="download"
                disabled={off || !lockups.length}
                onClick={() => void one('brand sheet PNG', 'png', 'PNG image', `${name} brand sheet`, () => sheetPng(d, name))}
              >
                {busy === 'brand sheet PNG' ? 'Exporting…' : 'PNG'}
              </Button>
            </div>
          }
        />
      </div>
    </Module>
  );
}
