// The Parts group (spec §5): the icon and the wordmark, each as its artwork alone (the file's own
// box trimmed away), what was measured in a tooltip, and Replace (a menu: replace, swap, remove).
// An empty part is a place to drop one.
import { useMemo } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { holdsPicture } from '../../../shared/logo/svg.ts';
import { framed, parseSize } from '../../../shared/svg/index.ts';
import { Button, ConfirmInline, InspectorGroup, Tooltip, type MenuItem } from '../../ui/index.ts';
import { GREY_18 } from '../common/surround.ts';
import { pasteInto, removePart, swapParts, type Doc } from './actions.ts';
import type { LogoDoc, Part, Role } from './doc.ts';
import { libraryParts, openMenu, PartSlot, useFilePick } from './PartDrop.tsx';
import { useSvgUrl } from './raster.ts';
import { armed, loading } from './view-state.ts';
import s from './Parts.module.css';

const ROLES: Role[] = ['icon', 'wordmark'];
const TITLE: Record<Role, string> = { icon: 'Icon', wordmark: 'Wordmark' };

const n = (v: number) => (v >= 100 ? Math.round(v) : +v.toFixed(1));
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** what was measured, in words that fit a mono line each */
function measured(p: Part, role: Role): string[] {
  const { w, h } = p.box;
  const lines: string[] = [];
  if (p.svg) {
    const [, , fw, fh] = parseSize(p.svg).viewBox;
    lines.push(`SVG · artwork ${n(w)} × ${n(h)}`);
    if (Math.abs(fw - w) > fw * 0.005 || Math.abs(fh - h) > fh * 0.005) lines.push(`Trimmed from ${n(fw)} × ${n(fh)}`);
    if (holdsPicture(p.svg)) lines.push('Holds a picture: colour versions leave it as it is');
  } else {
    lines.push(`PNG · ${n(w)} × ${n(h)} px, margins trimmed`);
  }
  if (role === 'wordmark') {
    const t = p.type;
    lines.push(t ? `Cap height ${pct((t.baseline - t.capTop) / h)} · below the baseline ${pct((p.box.y + h - t.baseline) / h)}` : 'No cap height found: aligns by the artwork');
  }
  return lines;
}

export function Parts({ doc, d }: { doc: Doc; d: LogoDoc }) {
  const busy = loading.use();
  const armedRole = armed.use();
  const count = ROLES.filter((r) => d[r]).length;
  return (
    <InspectorGroup id="logo.parts" title="Parts" meta={busy.length ? 'Reading…' : count}>
      <div className={s.list}>
          {ROLES.map((role) => {
            const part = d[role];
            if (!part) return <PartSlot key={role} doc={doc} role={role} />;
            if (armedRole === role)
              return (
                <ConfirmInline
                  key={role}
                  icon="delete"
                  title={`Remove the ${role}, ${part.name}?`}
                  detail={`Lockups that need a ${role} stop showing until another arrives. Undo brings it back.`}
                  confirmLabel="Remove"
                  danger
                  onConfirm={() => removePart(doc, role)}
                  onKeep={() => armed.set(null)}
                />
              );
            return <PartRow key={role} doc={doc} d={d} role={role} part={part} />;
          })}
      </div>
    </InspectorGroup>
  );
}

function PartRow({ doc, d, role, part }: { doc: Doc; d: LogoDoc; role: Role; part: Part }) {
  const { pick, input } = useFilePick(doc, role);
  const other: Role = role === 'icon' ? 'wordmark' : 'icon';
  const lines = useMemo(() => measured(part, role), [part, role]);
  const items: MenuItem[] = [
    { label: 'Replace from the Library', icon: 'photo_library', submenu: libraryParts(role) },
    { label: 'Replace from a file…', icon: 'upload_file', onSelect: pick },
    { label: 'Replace with copied SVG', icon: 'content_paste', onSelect: () => void pasteInto(doc, role) },
    { label: d[other] ? 'Swap icon and wordmark' : `Use as the ${other}`, icon: 'swap_vert', onSelect: () => void swapParts(doc) },
    'separator',
    { label: 'Remove', icon: 'delete', danger: true, onSelect: () => armed.set(role) },
  ];
  const brief = role === 'wordmark' ? (part.type ? 'caps found' : 'no caps found') : `${n(part.box.w)} × ${n(part.box.h)}`;
  return (
    <div className={s.row} data-part={role}>
      <Thumb part={part} role={role} />
      <div className={s.ident}>
        <span className={s.role}>{TITLE[role]}</span>
        <Tooltip content={[part.name, ...lines].join(' · ')}>
          <span className={s.name}>
            {part.name} · {brief}
          </span>
        </Tooltip>
      </div>
      <Button size="xs" variant="ghost" onClick={(e) => openMenu(e, items)} tooltip={`${TITLE[role]}: replace, swap or remove`}>
        Replace
      </Button>
      {input}
    </div>
  );
}

/**
 * The artwork alone, its measured box filling the thumbnail, on the 18% grey where black and white
 * both show; a wordmark shows the cap line and baseline found on it.
 */
function Thumb({ part, role }: { part: Part; role: Role }) {
  const { x, y, w, h } = part.box;
  const svg = useMemo(() => (part.svg ? framed(part.svg, 192, Math.max(1, Math.round((192 * h) / w)), [x, y, w, h]) : null), [part.svg, x, y, w, h]);
  const url = useSvgUrl(svg);
  const t = role === 'wordmark' ? part.type : undefined;
  const src = part.svg ? url : part.png;
  return (
    <svg className={s.thumb} style={{ background: cssColor(GREY_18) }} viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {src && <image href={src} x={x} y={y} width={w} height={h} preserveAspectRatio="none" />}
      {t && (
        <path className={s.guide} d={`M${x - w * 0.04} ${t.capTop}H${x + w * 1.04}M${x - w * 0.04} ${t.baseline}H${x + w * 1.04}`} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
