// Loop (spec §3): how long a still's moving effects run before they come round again, and at what
// rate. Time wraps exactly at the loop's length, so the last frame runs into the first with no jump.
// A clip or a GIF is its own loop: its length and rate show here, and the effects follow them.
import { InspectorGroup, InspectorRow, NumberField, Slider, useDocNumber } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { fix, LIMIT, type PostFxDoc, type Timeline } from './doc.ts';
import { fmtFps } from './media-time.ts';
import s from './Loop.module.css';

export function LoopModule({ doc, d, t }: { doc: Doc; d: PostFxDoc; t: Timeline }) {
  const seconds = useDocNumber(doc, { label: 'Change the loop length', key: 'loop:seconds', get: (x) => x.loop.seconds, set: (x, v) => fix({ ...x, loop: { ...x.loop, seconds: v } }) });
  const fps = useDocNumber(doc, { label: 'Change the loop frame rate', key: 'loop:fps', get: (x) => x.loop.fps, set: (x, v) => fix({ ...x, loop: { ...x.loop, fps: v } }) });
  const own = t.kind === 'gif' || t.kind === 'video';
  const noun = t.kind === 'gif' ? 'The GIF' : 'The clip';
  // with nothing moving there is no loop to set: the controls wait, set back, until a moving effect is in the stack
  const idle = t.kind !== 'loop';
  return (
    <InspectorGroup id="postfx.loop" title="Loop" meta={t.count > 1 ? `${plural(t.count, 'frame')} · ${t.seconds.toFixed(2)} s` : 'Still'} defaultOpen={false}>
      {own ? (
        <>
          <InspectorRow label="Length" info={`${noun} is the loop: moving effects run once through its length, so they repeat with it.`}>
            <span className={s.fact}>
              <b>{t.seconds.toFixed(2)}</b> s
            </span>
          </InspectorRow>
          <InspectorRow label="Rate">
            <span className={s.fact}>{t.delays ? 'its own frame times' : <><b>{fmtFps(t.fps)}</b> fps</>}</span>
          </InspectorRow>
          <InspectorRow label="Frames">
            <span className={s.fact}>
              <b>{t.count}</b>
            </span>
          </InspectorRow>
        </>
      ) : (
        <>
          <Slider
            label="Length"
            info={idle ? 'Nothing in the stack moves yet, so the image exports as one frame. Grain, VHS, glitch, wave and light leak move when played.' : 'Moving effects come round exactly at the end, so the GIF and the frames repeat with no jump.'}
            min={LIMIT.seconds[0]}
            max={LIMIT.seconds[1]}
            step={0.1}
            precision={1}
            unit="s"
            disabled={idle}
            {...seconds}
          />
          <InspectorRow label="Rate">
            <NumberField label="FPS" min={LIMIT.fps[0]} max={LIMIT.fps[1]} step={1} width={120} disabled={idle} {...fps} />
            {!idle && <span className={s.fact}>{plural(Math.max(1, Math.round(d.loop.seconds * d.loop.fps)), 'frame')} a loop</span>}
          </InspectorRow>
        </>
      )}
    </InspectorGroup>
  );
}
