// Style and Accent: how a role palette is built. On the start panel they only set what Build uses; once
// the palette has colours, changing one rerolls the unlocked ones in place (a locked colour stays).
import { ACCENTS, STYLE_LIST } from '../../../shared/palette/brand.ts';
import { InfoTip, Select } from '../../ui/index.ts';
import { restyle, type Doc } from './actions.ts';
import type { DesignView } from './doc.ts';

export function StyleFields({ doc, v, className }: { doc: Doc; v: DesignView; className?: string }) {
  const style = STYLE_LIST.find((p) => p.id === v.preset);
  return (
    <>
      <Select label="Style" options={STYLE_LIST.map((p) => ({ value: p.id, label: p.label }))} value={v.preset} onChange={(preset) => restyle(doc, { preset })} className={className} />
      {style && <InfoTip text={style.describe} />}
      <Select label="Accent" options={ACCENTS} value={v.accent} onChange={(accent) => restyle(doc, { accent })} className={className} />
    </>
  );
}
