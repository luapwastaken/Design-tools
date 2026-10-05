import { Icon } from './Icon.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './InfoTip.module.css';

/**
 * The (i) after a label: the sentence that used to sit as a paragraph under the control, shown in
 * the shared Tooltip. One line of help each; anything longer is not help, it is a design problem.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <span className={s.info} role="img" aria-label={text}>
        <Icon name="info" size={14} />
      </span>
    </Tooltip>
  );
}
