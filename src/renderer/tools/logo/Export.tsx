// Export (spec §3): the lockup being edited as an editable SVG or a PNG at a set height, every lockup ×
// version into one folder, the favicon bundle and the brand sheet. All through the shared export
// path (lib/export saveFile, saveToFolder); every failure is a toast.
import { layoutLockup } from '../../../shared/logo/layout.ts';
import { lockupSvg } from '../../../shared/logo/svg.ts';
import { leaf, saveFile, saveToFolder } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Module, NumberField, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { ExportButton, ExportList, ExportRow, LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { fix, KIND_LABEL, LIMIT, shownLockups, shownVersions, VERSION_LABEL, type Lockup, type LogoDoc } from './doc.ts';
import { buffer, everyFile, faviconBundle, fileName, lockupPng, sheetPng, sheetSvg, type OutFile } from './files.ts';
import { pngSize } from './geometry.ts';
import { tooBig } from './raster.ts';
import { patchView, type LogoView } from './view-state.ts';
import s from './Export.module.css';

export function ExportModule({ doc, d, v, lockup }: { doc: Doc; d: LogoDoc; v: LogoView; lockup: Lockup | null }) {
  const name = useShell((st) => st.docNames.logo) ?? 'Logo';
  const ex = useExport((last) => patchView({ last }));
  const height = useDocNumber(doc, { label: 'Change the PNG height', key: 'pngHeight', get: (x) => x.pngHeight, set: (x, h) => fix({ ...x, pngHeight: h }) });
  const lockups = shownLockups(d);
  const versions = shownVersions(d);

  const one = (what: string, ext: string, filterName: string, suggestedName: string, data: () => Promise<ArrayBuffer | string>) =>
    ex.file(what, async () => saveFile({ tool: 'logo', suggestedName, ext, filterName, data: await data() }));
  const many = (what: string, files: () => Promise<OutFile[]>) =>
    ex.run(what, async () => {
      const r = await saveToFolder({ tool: 'logo', files: await files() });
      return r && { path: r.folder, label: `${plural(r.written.length, 'file')} into ${leaf(r.folder)}` };
    });

  const sized = lockup && pngSize(d, layoutLockup(d, lockup), v.version);
  const pngProblem = sized && tooBig(sized.w, sized.h);
  // Export all makes every PNG: the widest one on decides
  const allProblem = lockups.flatMap((l) => versions.map((x) => pngSize(d, layoutLockup(d, l), x))).map((p) => tooBig(p.w, p.h)).find(Boolean) ?? null;
  const noIcon = !d.icon ? 'The favicon is made from the icon. Add an icon first.' : null;

  return (
    <Module title="Export" sub={lockup ? `${KIND_LABEL[lockup.kind]} · ${VERSION_LABEL[v.version]}` : undefined}>
      <ExportList>
        {lockup && (
          <>
            <ExportRow
              main
              name="SVG"
              desc="The lockup in its version as real paths with their own fills, each part one group: editable in Illustrator."
              action={<ExportButton ex={ex} what="SVG" lead onClick={() => void one('SVG', 'svg', 'SVG', fileName(name, lockup, v.version), async () => lockupSvg(d, lockup, v.version, { padding: d.exportPadding }))} />}
            />
            <ExportRow
              name="PNG"
              desc={v.version === 'knockout' ? 'The same at a set height on its colour field, the DPI written in.' : 'The same at a set height, transparent round the logo, the DPI written in.'}
              action={
                <ExportButton ex={ex} what="PNG" why={pngProblem} onClick={() => void one('PNG', 'png', 'PNG image', fileName(name, lockup, v.version), async () => buffer(await lockupPng(d, lockup, v.version, v.dpi)))} />
              }
            >
              <div className={s.pair}>
                <NumberField label="Height" min={LIMIT.pngHeight[0]} max={LIMIT.pngHeight[1]} unit="px" {...height} />
                <NumberField label="DPI" min={LIMIT.dpi[0]} max={LIMIT.dpi[1]} value={v.dpi} onChange={(dpi) => patchView({ dpi })} />
              </div>
              {sized && (
                <span className={cx('lbl', pngProblem && s.danger)}>
                  {fmtPx(sized.w, sized.h)}
                  {pngProblem ? ' · too big' : ''}
                </span>
              )}
            </ExportRow>
          </>
        )}

        <ExportRow
          main={!lockup}
          name="Export all"
          desc="Every lockup that’s on in every version that’s on, as SVG and PNG, into one folder."
          action={
            <ExportButton ex={ex} what="files" folder lead={!lockup} disabled={!lockups.length || !versions.length} why={allProblem} onClick={() => void many('files', () => everyFile(d, name, v.dpi))}>
              Export all…
            </ExportButton>
          }
        >
          <span className="lbl">
            {plural(lockups.length, 'lockup')} × {plural(versions.length, 'version')} · {lockups.length * versions.length * 2} files
          </span>
        </ExportRow>

        <ExportRow
          name="Favicon bundle"
          desc={`From the icon in ${VERSION_LABEL[v.version].toLowerCase()}: favicon.ico, PNGs from 16 to 512 px, an Apple touch icon, icon.svg and a web manifest, into one folder.`}
          action={<ExportButton ex={ex} what="favicon bundle" folder why={noIcon} onClick={() => void many('favicon bundle', () => faviconBundle(d, v.version, name))} />}
        />

        <ExportRow
          name="Brand sheet"
          desc="One page with every lockup and version, the clearspace, the small sizes and the colours, to drop into a guidelines document."
          action={
            <div className={s.buttons}>
              <ExportButton ex={ex} what="brand sheet" disabled={!lockups.length} onClick={() => void one('brand sheet', 'svg', 'SVG', `${name} brand sheet`, () => sheetSvg(d, name))}>
                SVG
              </ExportButton>
              <ExportButton ex={ex} what="brand sheet PNG" disabled={!lockups.length} onClick={() => void one('brand sheet PNG', 'png', 'PNG image', `${name} brand sheet`, () => sheetPng(d, name))}>
                PNG
              </ExportButton>
            </div>
          }
        />
      </ExportList>
      <LastExport last={v.last} />
    </Module>
  );
}
