// The empty state in the Ramps section: what a ramp is, in one line, and where to start. The Add colour row
// above it (with its Add by hex field) is the way in, as it is once there are ramps.
import s from './Start.module.css';

export function Start() {
  return (
    <section className={s.start} aria-label="Start">
      <p className={s.lead}>No ramps yet. A ramp is one colour from highlight to deep shadow, ready to paint with.</p>
      <p className={s.fine}>Pick a light, then add a colour: type a hex above and press Enter, or use From… to add several at once or start from what is in the picture.</p>
    </section>
  );
}
