// Contrast tab: the selected colour as text on every other colour, then the palette's role pairs
// with the one-click fixes the checks have.
import { useMemo } from 'react';
import { contrast, cssColor } from '../../../shared/color/index.ts';
import type { ContrastPair } from '../../../shared/palette/checks.ts';
import { isGround, isInk, ROLES } from '../../../shared/palette/roles.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, Tooltip } from '../../ui/index.ts';
import { fmtL } from '../common/names.ts';
import { activeSwatch, setColours, setRole, type Doc } from './actions.ts';
import { displayName, listNames, named, nameIn, type DesignDoc, type DesignView } from './doc.ts';
import type { Results } from './results.ts';
import { pointAt } from './view-state.ts';
import s from './Tabs.module.css';

type Tone = 'ok' | 'mid' | 'bad';
const gradeOf = (ratio: number): { label: string; tone: Tone } =>
  ratio >= 7 ? { label: 'AAA', tone: 'ok' } : ratio >= 4.5 ? { label: 'AA', tone: 'ok' } : ratio >= 3 ? { label: 'Large only', tone: 'mid' } : { label: 'Fails', tone: 'bad' };

const fixVerb = (p: ContrastPair) => (p.fix!.oklch[0] > p.text.oklch[0] ? 'Lift' : 'Darken');

export function ContrastTab({ doc, d, v, r }: { doc: Doc; d: DesignDoc; v: DesignView; r: Results }) {
  const w = activeSwatch(d, v);
  const name = w ? nameIn(d, w) : '';
  // the colour under the picker's drag: the live document, not the settled one the checks read
  const live = useMemo(() => named(d.swatches, d.ramps), [d.swatches, d.ramps]);
  const others = useMemo(() => (w ? live.filter((x) => x.id !== w.id) : []), [live, w]);
  const mine = w ? live.find((x) => x.id === w.id) : undefined;
  const worst = r.failing.reduce<ContrastPair | null>((a, b) => (!a || b.ratio < a.ratio ? b : a), null);
  // free roles (a Border, a Disabled grey) aren't text, so they aren't paired; say so rather than leave them out silently
  const paired = new Set(r.contrast.flatMap((p) => [p.text.id, p.ground.id]));
  const free = r.shown.filter((x) => x.role !== null && !isGround(x.role) && !isInk(x.role) && !paired.has(x.id));
  const several = (p: ContrastPair) => r.contrast.filter((x) => x.text.id === p.text.id).length > 1;
  const held = ROLES.filter((role) => d.swatches.some((x) => x.role === role)).length;
  return (
    <>
      <div className={s.h3}>
        {w ? `${name} as text` : 'One colour as text'}
        <small>{w ? 'on every other colour · WCAG 2.2' : 'select a colour in the palette'}</small>
      </div>
      {mine && others.length > 0 ? (
        <div className={s.pairs}>
          {others.map((o) => {
            const ratio = contrast(mine.oklch, o.oklch);
            const g = gradeOf(ratio);
            return (
              <div key={o.id} className={s.pair} {...pointAt([mine.id, o.id])}>
                <span className={s.aa} style={{ background: cssColor(o.oklch), color: cssColor(mine.oklch) }}>
                  Aa
                </span>
                <span className={s.n}>
                  <span>on {displayName(o)}</span>
                  {o.role && <small>{o.role}</small>}
                </span>
                <span className={s.r}>{ratio.toFixed(2)}</span>
                <span className={cx(s.badge, s[g.tone])}>{g.label}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className={s.none}>{w ? 'Add another colour to compare it with.' : 'Pick a colour and see how it reads as text on every other.'}</p>
      )}

      <div className={s.h3}>
        Your role pairs
        <small>the pairs a real layout uses</small>
      </div>
      {r.contrast.length === 0 ? (
        <p className={s.none}>{d.swatches.length < 2 ? 'Add a text colour and a background to check them as a pair.' : 'Give swatches a Background or Surface role, or add a lighter or darker one, to pair text with grounds.'}</p>
      ) : (
        <div className={s.pairs}>
          {r.contrast.map((p) => (
            <RolePair key={`${p.text.id}:${p.ground.id}`} doc={doc} p={p} />
          ))}
        </div>
      )}
      {worst && (
        <p className={cx(s.note, s.bad)}>
          <Icon name="error" size={16} />
          <span>
            {worst.grade === 'Fail' ? `${displayName(worst.text)} fails as text on ${displayName(worst.ground)} at any size.` : `${displayName(worst.text)} on ${displayName(worst.ground)} passes only for large text and shapes.`}
            {!worst.fix && (several(worst) ? ' No lightness of this hue passes on every ground it sits on.' : ' No lightness of this hue reaches the target here.')}
          </span>
        </p>
      )}
      {free.length > 0 && (
        <p className={s.note}>
          <Icon name="info" size={16} />
          <span>Not checked as text: {listNames(free.map((x) => `${displayName(x)} (${x.role})`))}.</span>
        </p>
      )}

      {w && (
        <>
          <div className={s.h3}>
            Roles
            <small>
              {held} of {ROLES.length} held · click to give one to {name}
            </small>
          </div>
          <div className={s.roles}>
            {ROLES.map((role) => {
              const owner = d.swatches.find((x) => x.role === role);
              return (
                <Tooltip key={role} content={owner ? (owner.id === w.id ? `${name} is the ${role}` : `${displayName(owner)} is the ${role}. Click to give it to ${name}.`) : `Give ${name} the ${role} job`}>
                  <button type="button" className={cx(s.roleChip, owner && s.held, owner?.id === w.id && s.mine)} onClick={() => setRole(doc, w.id, owner?.id === w.id ? null : role)}>
                    {owner && <i className={s.dot} style={{ background: cssColor(owner.oklch) }} />}
                    <span>{role}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function RolePair({ doc, p }: { doc: Doc; p: ContrastPair }) {
  const g = p.ratio < p.target ? (p.grade === 'Fail' ? { label: 'Fails', tone: 'bad' as Tone } : { label: 'Large only', tone: 'mid' as Tone }) : gradeOf(p.ratio);
  const fix = () => p.fix && setColours(doc, `${fixVerb(p)} ${displayName(p.text)} for contrast`, { [p.fix.swatchId]: p.fix.oklch });
  return (
    <div className={cx(s.pair, p.ratio < p.target && s.failing)} data-fixable={p.fix ? '' : undefined} {...pointAt([p.text.id, p.ground.id])}>
      <span className={s.aa} style={{ background: cssColor(p.ground.oklch), color: cssColor(p.text.oklch) }}>
        Aa
      </span>
      <span className={s.n}>
        <span>
          {displayName(p.text)} on {displayName(p.ground)}
        </span>
        <small>
          {p.text.role ?? 'No role'} on {p.ground.role ?? 'a ground'}
        </small>
      </span>
      <span className={s.r}>{p.ratio.toFixed(2)}</span>
      <span className={cx(s.badge, s[g.tone])}>{g.label}</span>
      {p.fix && (
        <Button size="xs" onClick={fix} className={s.fix} tooltip={`${fixVerb(p)} ${displayName(p.text)} to L ${fmtL(p.fix.oklch[0])} for ${p.fix.ratio.toFixed(2)}:1`}>
          {fixVerb(p)} to L {fmtL(p.fix.oklch[0])}
        </Button>
      )}
    </div>
  );
}
