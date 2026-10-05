// Export (spec §3, §5): a checklist of assets and one primary button, which the doc bar's Export
// repeats. The SVG and PNG rows write the lockup in view, that lockup in every version that's on,
// or every lockup in every version, as the scope says; the favicon bundle and the brand sheet
// come with them. One file goes through the save dialog, several into one folder. All through the
// shared export path (lib/export saveFile, saveToFolder); every failure is a toast.
import type { ReactNode } from 'react';
import { layoutLockup } from '../../../shared/logo/layout.ts';
import { lockupSvg } from '../../../shared/logo/svg.ts';
import { leaf, saveFile, saveToFolder } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { InspectorGroup, InspectorRow, NumberField, Segmented, Toggle, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { CopyButton, ExportButton, LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { fix, KIND_LABEL, LIMIT, shownLockups, shownVersions, VERSION_LABEL, type Lockup, type LogoDoc } from './doc.ts';
import { buffer, faviconBundle, fileName, lockupPng, sheetPng, sheetSvg, type OutFile } from './files.ts';
import { pngSize } from './geometry.ts';
import { tooBig } from './raster.ts';
import { patchView, type Assets, type LogoView, type Scope } from './view-state.ts';
import s from './Export.module.css';

const SCOPES: { value: Scope; label: string; tip: string }[] = [
  { value: 'view', label: 'View', tip: 'The lockup you are looking at, in the version you are looking at' },
  { value: 'lockup', label: 'Lockup', tip: 'The lockup you are looking at, in every version that is on' },
  { value: 'all', label: 'All', tip: 'Every lockup that is on, in every version that is on' },
];

/**
 * What Export would make now, and the one function that makes it: the group's primary button and the
 * doc bar's Export both call `go`. `why` is the reason it can't, or null.
 */
export function useLogoExport(doc: Doc, d: LogoDoc, v: LogoView, lockup: Lockup | null) {
  const name = useShell((st) => st.docNames.logo) ?? 'Logo';
  const ex = useExport((last) => patchView({ last }));
  const lockups = v.scope === 'all' ? shownLockups(d) : lockup ? [lockup] : [];
  const versions = v.scope === 'view' ? [v.version] : shownVersions(d);
  const pairs = lockups.flatMap((l) => versions.map((x) => [l, x] as const));
  const asked = (Object.keys(v.assets) as (keyof Assets)[]).filter((k) => v.assets[k]);
  const vector = v.assets.svg || v.assets.png;
  const png = v.assets.png ? (pairs.map(([l, x]) => pngSize(d, layoutLockup(d, l), x)).map((p) => tooBig(p.w, p.h)).find(Boolean) ?? null) : null;
  const why =
    !asked.length
      ? 'Tick at least one asset'
      : vector && !pairs.length
        ? 'Every lockup is off. Turn one on in Lockups.'
        : v.assets.favicon && !d.icon
          ? 'The favicon is made from the icon. Add an icon first.'
          : v.assets.sheet && !shownLockups(d).length
            ? 'The brand sheet shows the lockups that are on. Turn one on first.'
            : png;

  /** every file the ticked assets make */
  const files = async (): Promise<OutFile[]> => {
    const out: OutFile[] = [];
    for (const [l, x] of pairs) {
      if (v.assets.svg) out.push({ name: `${fileName(name, l, x)}.svg`, data: lockupSvg(d, l, x, { padding: d.exportPadding }) });
      if (v.assets.png) out.push({ name: `${fileName(name, l, x)}.png`, data: await buffer(await lockupPng(d, l, x, v.dpi)) });
    }
    if (v.assets.favicon) out.push(...(await faviconBundle(d, v.version, name)));
    if (v.assets.sheet) out.push(v.sheet === 'png' ? { name: `${name} brand sheet.png`, data: await sheetPng(d, name) } : { name: `${name} brand sheet.svg`, data: await sheetSvg(d, name) });
    return out;
  };

  const go = () => {
    if (why || ex.busy) return;
    const what = 'assets';
    void ex.run(what, async () => {
      const made = await files();
      if (made.length === 1) {
        const [f] = made;
        const dot = f.name.lastIndexOf('.');
        const ext = f.name.slice(dot + 1);
        const path = await saveFile({ tool: 'logo', suggestedName: f.name.slice(0, dot), ext, filterName: ext === 'png' ? 'PNG image' : 'SVG', data: f.data });
        return path ? { path, label: leaf(path) } : null;
      }
      const r = await saveToFolder({ tool: 'logo', files: made });
      return r ? { path: r.folder, label: `${plural(r.written.length, 'file')} into ${leaf(r.folder)}` } : null;
    });
  };

  return { ex, go, why, count: asked.length, pairs, lockups, versions };
}

export type LogoExport = ReturnType<typeof useLogoExport>;

function Asset({ label, checked, onChange, sub, right }: { label: string; checked: boolean; onChange(on: boolean): void; sub: string; right?: ReactNode }) {
  return (
    <div className={s.asset} data-asset={label}>
      <div className={s.main}>
        <Toggle label={label} checked={checked} onChange={onChange} />
        <span className={s.sub}>{sub}</span>
      </div>
      {right && <span className={s.right}>{right}</span>}
    </div>
  );
}

export function ExportGroup({ doc, d, v, lockup, out }: { doc: Doc; d: LogoDoc; v: LogoView; lockup: Lockup | null; out: LogoExport }) {
  const { ex, go, why, count, pairs, lockups, versions } = out;
  const height = useDocNumber(doc, { label: 'Change the PNG height', key: 'pngHeight', get: (x) => x.pngHeight, set: (x, h) => fix({ ...x, pngHeight: h }) });
  const tick = (k: keyof Assets) => (on: boolean) => patchView({ assets: { ...v.assets, [k]: on } });
  const sized = lockup && pngSize(d, layoutLockup(d, lockup), v.version);
  const tooBigNow = sized && tooBig(sized.w, sized.h);
  const reach = v.scope === 'view' ? `${lockup ? KIND_LABEL[lockup.kind] : 'No lockup'}, ${VERSION_LABEL[v.version]}` : v.scope === 'lockup' ? `${lockup ? KIND_LABEL[lockup.kind] : 'No lockup'}, ${plural(versions.length, 'version')}` : `${plural(lockups.length, 'lockup')}, ${plural(versions.length, 'version')}`;
  const markup = () => lockupSvg(d, lockup!, v.version, { padding: d.exportPadding });

  return (
    <InspectorGroup id="logo.export" title="Export" meta={`${count} selected`}>
      <InspectorRow label="Scope" info="What the SVG and PNG rows write: the lockup in view, that lockup in every version that is on, or every lockup in every version.">
        <Segmented fit options={SCOPES} value={v.scope} onChange={(scope) => patchView({ scope })} />
      </InspectorRow>
      <div className={s.list}>
        <Asset label="SVG" checked={v.assets.svg} onChange={tick('svg')} sub={reach} right={v.assets.svg && pairs.length > 1 ? plural(pairs.length, 'file') : 'editable'} />
        <Asset
          label="PNG"
          checked={v.assets.png}
          onChange={tick('png')}
          sub={`${d.pngHeight} px high · ${v.dpi} dpi`}
          right={<span className={cx(tooBigNow && s.danger)}>{sized ? fmtPx(sized.w, sized.h) : ''}</span>}
        />
        <Asset label="Favicon bundle" checked={v.assets.favicon} onChange={tick('favicon')} sub={`ico, 16 to 512, touch icon, manifest · ${VERSION_LABEL[v.version].toLowerCase()}`} />
        <Asset
          label="Brand sheet"
          checked={v.assets.sheet}
          onChange={tick('sheet')}
          sub="one page, every lockup and version"
          right={<Segmented mono fit options={[{ value: 'svg', label: 'SVG' }, { value: 'png', label: 'PNG' }]} value={v.sheet} onChange={(sheet) => patchView({ sheet })} />}
        />
      </div>
      <InspectorRow label="PNG size" pair>
        <NumberField label="Height" min={LIMIT.pngHeight[0]} max={LIMIT.pngHeight[1]} unit="px" {...height} />
        <NumberField label="DPI" min={LIMIT.dpi[0]} max={LIMIT.dpi[1]} value={v.dpi} onChange={(dpi) => patchView({ dpi })} />
      </InspectorRow>
      <div className={s.go} data-export="go">
        <ExportButton ex={ex} what="assets" lead folder={count !== 1 || pairs.length !== 1} why={why} onClick={go}>
          {count === 1 && pairs.length === 1 ? 'Export…' : `Export ${plural(count, 'asset')}…`}
        </ExportButton>
        <div data-row="SVG" className={s.copy}>
          <CopyButton ex={ex} what="SVG" why={lockup ? null : 'Every lockup is off'} onClick={() => void ex.copySvg('SVG', async () => markup())} />
        </div>
      </div>
      <LastExport last={v.last} />
    </InspectorGroup>
  );
}
